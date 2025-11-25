'use strict';
const express = require('express');
const app = express();

app.use(express.json());

app.get('/tools', (req, res) => {
    res.status(200).json([{ name: "Test Tool", available_seats: 5 }]);
});

// CRITICAL: This line connects your code to Catalyst
module.exports = app;