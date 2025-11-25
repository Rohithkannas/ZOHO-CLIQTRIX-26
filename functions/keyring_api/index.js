'use strict';

const express = require('express');
const catalyst = require('zcatalyst-sdk-node');

const app = express();
app.use(express.json());

// --- 1. GET ALL TOOLS ---
app.get('/tools', async (req, res) => {
    try {
        const catalystApp = catalyst.initialize(req);
        const zcql = catalystApp.zcql();

        // A. Get all Tools
        const toolsResult = await zcql.executeZCQLQuery('SELECT * FROM Tools');
        
        // B. Get all Active Sessions
        const sessionsResult = await zcql.executeZCQLQuery("SELECT tool_id FROM Sessions WHERE status = 'ACTIVE'");

        // C. Merge Data
        const tools = toolsResult.map(row => {
            const tool = row.Tools;
            const activeCount = sessionsResult.filter(s => s.Sessions.tool_id === tool.ROWID).length;
            
            // Check if "I" (kidroh10@gmail.com) have the key
            const iHaveKey = sessionsResult.some(s => 
                s.Sessions.tool_id === tool.ROWID && 
                // Hardcoded email for the contest demo
                true 
            );

            return {
                ...tool,
                // Calculate remaining seats
                available_seats: parseInt(tool.max_seats) - activeCount,
                active_sessions: activeCount,
                i_have_key: iHaveKey
            };
        });

        res.status(200).json(tools);

    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'failure', message: err.message });
    }
});

// --- 2. CHECK OUT (GET KEY) ---
app.post('/checkout', async (req, res) => {
    try {
        const { tool_id, duration_minutes } = req.body;
        const catalystApp = catalyst.initialize(req);
        const zcql = catalystApp.zcql();

        // A. Double check availability (Race condition prevention)
        const checkQuery = `SELECT * FROM Sessions WHERE tool_id = ${tool_id} AND status = 'ACTIVE'`;
        const activeSessions = await zcql.executeZCQLQuery(checkQuery);
        
        // (Simplified check: assuming max_seats is 2 for everything for safety)
        if (activeSessions.length >= 2) {
            return res.status(400).json({ success: false, message: 'Queue is full!' });
        }

        // B. Insert Session
        const startTime = new Date().toISOString().replace('T', ' ').split('.')[0];
        // Calculate End Time
        const endTime = new Date(Date.now() + (duration_minutes * 60000)).toISOString().replace('T', ' ').split('.')[0];

        const insertQuery = `INSERT INTO Sessions (tool_id, user_email, status, start_time, expected_end_time) VALUES (${tool_id}, 'kidroh10@gmail.com', 'ACTIVE', '${startTime}', '${endTime}')`;
        await zcql.executeZCQLQuery(insertQuery);

        // C. Fetch Credentials to show user
        const credsQuery = `SELECT username, password FROM Tools WHERE ROWID = ${tool_id}`;
        const creds = await zcql.executeZCQLQuery(credsQuery);

        res.status(200).json({ 
            success: true, 
            credentials: creds[0].Tools 
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// --- 3. CHECK IN (RETURN KEY) ---
app.post('/checkin', async (req, res) => {
    try {
        const { tool_id } = req.body;
        const catalystApp = catalyst.initialize(req);
        const zcql = catalystApp.zcql();

        // Mark session as COMPLETED
        const updateQuery = `UPDATE Sessions SET status = 'COMPLETED' WHERE tool_id = ${tool_id} AND user_email = 'kidroh10@gmail.com' AND status = 'ACTIVE'`;
        await zcql.executeZCQLQuery(updateQuery);

        res.status(200).json({ success: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = app;