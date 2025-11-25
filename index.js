const express = require('express');
const catalyst = require('zcatalyst-sdk-node');

const app = express();
app.use(express.json());

// Attach Catalyst instance to each request
app.use((req, res, next) => {
  try {
    req.catalystApp = catalyst.initialize(req);
    next();
  } catch (err) {
    console.error('Catalyst init error:', err);
    res.status(500).json({ error: 'Catalyst initialization failed' });
  }
});

// Helper to execute ZCQL safely
async function runZCQL(zcql, query) {
  try {
    const result = await zcql.executeZCQLQuery(query);
    return result || [];
  } catch (err) {
    console.error('ZCQL error for query:', query, '\nError:', err);
    throw err;
  }
}

// Utility: format JS Date to "YYYY-MM-DD HH:MM:SS" for MySQL
function formatDateTime(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

// GET /tools
app.get('/tools', async (req, res) => {
  const zcql = req.catalystApp.zcql();

  try {
    const toolsRows = await runZCQL(
      zcql,
      'SELECT ROWID, name, max_seats, login_url, username, password, icon_url FROM Tools'
    );

    const activeSessionsRows = await runZCQL(
      zcql,
      "SELECT tool_id, COUNT(*) AS active_count FROM Sessions WHERE status = 'ACTIVE' GROUP BY tool_id"
    );

    const activeMap = {};
    activeSessionsRows.forEach((row) => {
      const r = row.Sessions || row;
      const toolId = r.tool_id;
      const count = Number(r.active_count) || 0;
      activeMap[toolId] = count;
    });

    const response = toolsRows.map((row) => {
      const t = row.Tools || row;
      const toolId = t.ROWID;
      const maxSeats = Number(t.max_seats) || 0;
      const active = activeMap[toolId] || 0;
      const available = Math.max(maxSeats - active, 0);

      return {
        ROWID: toolId,
        name: t.name,
        max_seats: maxSeats,
        login_url: t.login_url,
        username: t.username,
        password: t.password,
        icon_url: t.icon_url,
        active_sessions: active,
        available_seats: available,
      };
    });

    res.json(response);
  } catch (err) {
    console.error('Error in GET /tools:', err);
    res.status(500).json({ error: 'Failed to fetch tools' });
  }
});

// POST /checkout
app.post('/checkout', async (req, res) => {
  const { tool_id, user_email, duration_minutes } = req.body || {};
  const zcql = req.catalystApp.zcql();

  if (!tool_id || !user_email || !duration_minutes) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  const duration = parseInt(duration_minutes, 10);
  if (Number.isNaN(duration) || duration <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid duration_minutes' });
  }

  try {
    const tools = await runZCQL(
      zcql,
      `SELECT ROWID, name, max_seats, username, password FROM Tools WHERE ROWID = ${tool_id}`
    );

    if (!tools.length) {
      return res.status(404).json({ success: false, message: 'Tool not found' });
    }

    const toolRow = tools[0].Tools || tools[0];
    const maxSeats = Number(toolRow.max_seats) || 0;

    const activeRows = await runZCQL(
      zcql,
      `SELECT COUNT(*) AS active_count FROM Sessions WHERE tool_id = ${tool_id} AND status = 'ACTIVE'`
    );

    const activeCountRow = activeRows[0]?.Sessions || activeRows[0] || {};
    const activeCount = Number(activeCountRow.active_count) || 0;

    const availableSeats = maxSeats - activeCount;

    if (availableSeats <= 0) {
      return res.json({ success: false, message: 'Waitlist is full' });
    }

    const now = new Date();
    const expectedEnd = new Date(now.getTime() + duration * 60 * 1000);

    const startTimeStr = formatDateTime(now);
    const endTimeStr = formatDateTime(expectedEnd);

    const safeEmail = String(user_email).replace(/'/g, "\\'");
    const insertQuery = `
      INSERT INTO Sessions (tool_id, user_email, start_time, expected_end_time, status)
      VALUES (${tool_id}, '${safeEmail}', '${startTimeStr}', '${endTimeStr}', 'ACTIVE')
    `;

    await runZCQL(zcql, insertQuery);

    res.json({
      success: true,
      credentials: {
        username: toolRow.username,
        password: toolRow.password,
      },
    });
  } catch (err) {
    console.error('Error in POST /checkout:', err);
    res.status(500).json({ success: false, message: 'Checkout failed' });
  }
});

// POST /return
app.post('/return', async (req, res) => {
  const { tool_id, user_email } = req.body || {};
  const zcql = req.catalystApp.zcql();

  if (!tool_id || !user_email) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  try {
    const safeEmail = String(user_email).replace(/'/g, "\\'");
    const updateQuery = `
      UPDATE Sessions
      SET status = 'COMPLETED'
      WHERE tool_id = ${tool_id}
        AND user_email = '${safeEmail}'
        AND status = 'ACTIVE'
    `;

    await runZCQL(zcql, updateQuery);

    res.json({ success: true });
  } catch (err) {
    console.error('Error in POST /return:', err);
    res.status(500).json({ success: false, message: 'Return failed' });
  }
});

// POST /debug/add-tool
app.post('/debug/add-tool', async (req, res) => {
  const { name, max_seats, login_url, username, password, icon_url } = req.body || {};
  const zcql = req.catalystApp.zcql();

  if (!name || !max_seats || !login_url || !username || !password || !icon_url) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  try {
    const safeName = String(name).replace(/'/g, "\\'");
    const safeLoginUrl = String(login_url).replace(/'/g, "\\'");
    const safeUsername = String(username).replace(/'/g, "\\'");
    const safePassword = String(password).replace(/'/g, "\\'");
    const safeIconUrl = String(icon_url).replace(/'/g, "\\'");

    const insertQuery = `
      INSERT INTO Tools (name, max_seats, login_url, username, password, icon_url)
      VALUES (
        '${safeName}',
        ${parseInt(max_seats, 10)},
        '${safeLoginUrl}',
        '${safeUsername}',
        '${safePassword}',
        '${safeIconUrl}'
      )
    `;

    await runZCQL(zcql, insertQuery);

    res.json({ success: true });
  } catch (err) {
    console.error('Error in POST /debug/add-tool:', err);
    res.status(500).json({ success: false, message: 'Failed to add tool' });
  }
});

module.exports = app;
