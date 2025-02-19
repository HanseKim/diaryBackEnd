const Mysql = require('mysql2/promise');

const sql = Mysql.createPool({
    host: '203.245.30.195',
    user: 'sehantest',
    password: '12345678',
    database: 'DiaryDB',
    dateStrings : "date"
});

module.exports = sql;