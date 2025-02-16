const express = require('express');
const router = express.Router();
const db = require('../controllers/db_pool.js');

// 기본 주소 /home

router.post('/', async (req, res) => {
    const { user_id } = req.body;
    console.log("Home endpoint called. user_id:", user_id);
  
    if (!user_id) {
      return res.status(400).json({ success: false, message: "user_id가 없습니다." });
    }
  
    const sql = 'SELECT * FROM diarytable WHERE user_id = ?';
  
    try {
      const [results] = await db.query(sql, [user_id]); // 프로미스 기반 쿼리 실행
      console.log("Query Results:", results);
      res.json({ success: true, message: '조회 성공', data: results });
    } catch (err) {
      console.error('Error executing query:', err.message);
      res.status(500).json({ success: false, message: '서버 오류' });
    }
});

module.exports = router;