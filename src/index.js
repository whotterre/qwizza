"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = void 0;
require("dotenv/config");
var node_postgres_1 = require("drizzle-orm/node-postgres");
var pg_1 = require("pg");
exports.pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 100,
    min: 10,
    idleTimeoutMillis: 30000,
    ssl: ((_a = process.env.DATABASE_URL) === null || _a === void 0 ? void 0 : _a.includes('localhost')) ? false : {
        rejectUnauthorized: false,
    },
});
exports.pool.on('error', function (err) {
    console.error('Unexpected error on idle client', err);
});
var db = (0, node_postgres_1.drizzle)(exports.pool);
exports.default = db;
