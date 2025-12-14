"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const router = (0, express_1.Router)();
// All editing routes are disabled - return HTTP 410 (Gone) for all requests
router.use((req, res) => {
    console.log(`🚫 Editing route blocked: ${req.method} ${req.originalUrl}`);
    res.status(410).json({ error: "Editing routes are disabled" });
});
exports.default = router;
