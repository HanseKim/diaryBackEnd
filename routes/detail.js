const express = require('express');
const router = express.Router();
const db = require('../controllers/db_pool.js');

// 기본 주소 /detail

router.post('/', async (req, res) => {
    const { user_id, diary_date } = req.body;
    console.log("Detail endpoint called. user_id:", user_id, "diary_date:", diary_date);
    const sql = 'SELECT * FROM diarytable WHERE user_id = ? AND diary_date = ?';
    try {
      const [results] = await db.query(sql, [user_id, diary_date]);
      console.log("Detail Results:", results);
      res.json({ success: true, message: '조회 성공', data: results });
    } catch (err) {
      console.error('Error executing query:', err.message);
      res.status(500).json({ success: false, message: '서버 오류' });
    }
});

module.exports = router;