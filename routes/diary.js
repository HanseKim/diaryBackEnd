const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../controllers/db_pool.js');

// 기본 호스팅 주소 /diary

// diaryScreen 엔드포인트
router.post('/write', async (req, res) => {
    const { title, user_id, content, feeling, privacy, diary_date } = req.body;
  
    // privacy가 'couple'이고 오늘 날짜에 일기가 있는지 확인하는 쿼리
    const checkQuery = `SELECT COUNT(*) as count FROM diarytable WHERE user_id = ? AND privacy = ? AND diary_date = ?`;
  
    try {
      const [checkResults] = await db.query(checkQuery, [user_id, 'Couple', diary_date]);
  
      if (checkResults[0].count > 0) {
        return res.status(401).json({ error: "Diary entry for today with privacy 'Couple' already exists." });
      }
  
      // 일기 작성 쿼리
      const query = `INSERT INTO diarytable (title, user_id, content, feeling, privacy, diary_date) VALUES (?, ?, ?, ?, ?, ?)`;
      const [results] = await db.query(query, [title, user_id, content, feeling, privacy, diary_date]);
  
      console.log("Query Results:", results);
      res.status(200).json(results);
    } catch (err) {
      console.error("Database Error:", err);
      res.status(500).json({ error: "Failed to write diary entry" });
    }
});

//search 엔드포인트
router.post("/search-diary", async (req, res) => {
  const { user_id } = req.body;
  console.log("user_id:", user_id); // user_id가 제대로 전달되는지 확인
  const query = "SELECT * FROM diarytable WHERE user_id = ?";
  try {
    const [results] = await db.query(query, [user_id]); // Promise 기반 사용
    console.log("Search Results:", results);
    res.status(200).json(results);
  } catch (err) {
    console.error("Database Error:", err);
    res.status(500).json({ error: "Failed to fetch diary entries" });
  }
});

//수정 데이터 받아오기
router.post("/edit-search", async (req, res) => {
  const { id } = req.body;
  const query = "SELECT * FROM diarytable WHERE id = ?";
  console.log("id:", id);
  try {
    const [results] = await db.query(query, [id]); // Promise 기반 사용
    console.log("edit-search result :", results[0]);
    res.status(200).json(results[0]);
  } catch (err) {
    console.error("Database Error:", err);
    res.status(500).json({ error: "Failed to fetch diary entries" });
  }
});

//UPDATE
router.post("/edit-diary", async (req, res) => {
  const { title, id, user_id, content, feeling, privacy, diary_date } = req.body;
  const query = `UPDATE diarytable SET title = ?, user_id = ?, content = ?, feeling = ?, privacy = ?, diary_date = ? WHERE id = ?`;

  try {
    const [results] = await db.query(query, [title, user_id, content, feeling, privacy, diary_date, id]); // Promise 기반 사용
    console.log("edit Results:", results);
    
    const [result] = await db.query("SELECT * FROM diarytable WHERE id = ?", [id]);
    console.log("edit result :", result[0]);

    res.status(200).json(result[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to edit data into diarytable" });
  }
})

module.exports = router; 