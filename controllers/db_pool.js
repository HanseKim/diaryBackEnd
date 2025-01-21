const Mysql = require('mysql2/promise');

const sql = Mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '1230sehan@',
    database: 'DiaryDB',
    dateStrings : "date"
});

module.exports = sql;