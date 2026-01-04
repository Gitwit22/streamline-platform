"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const router = (0, express_1.Router)();
router.post("/upload", (req, res) => {
    res.json({ ok: true });
});
router.get("/list", (req, res) => {
    res.json([]);
});
router.post("/save", (req, res) => {
    res.json({ ok: true });
});
router.post("/render", (req, res) => {
    res.json({ status: "queued" });
});
exports.default = router;
