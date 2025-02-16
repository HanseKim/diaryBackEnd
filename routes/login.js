const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../controllers/db_pool.js');
const JWT_SECRET = "diary app key for jwt"; 
const authenticateJWT = require('../auth/authenticate.js');

// 기본 호스팅 주소 /login

//로그인
router.post("/", async (req, res) => {
    const { id, password } = req.body;

    try {
      const [user] = await db.query("SELECT * FROM users WHERE id = ?", [id]);
      const User = user[0];
  
      if (User && await bcrypt.compare(password, User.password)) {
        // 최근 30일간의 public 일기 개수 계산
        const [monthDiaryCount] = await db.query(
          `SELECT COUNT(*) AS count 
            FROM diarytable 
            WHERE user_id = ? 
              AND privacy = 'Couple' 
              AND diary_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`,
          [id]
        );
  
        // 전체 일기 개수 계산
        const [allDiaryCount] = await db.query(
          `SELECT COUNT(*) AS count 
            FROM diarytable 
            WHERE user_id = ? AND privacy = 'Couple'`,
          [id]
        );
  
        const monthDiary = monthDiaryCount[0].count || 0;
        const allDiary = allDiaryCount[0].count || 0;
  
        // 커플 public 일기 개수 계산
        let coupleMonth = 0;
        let coupleAll = 0;
        let coupleId = null;
        if (User.coupleName) {
          // 커플 user_id 배열 생성
          coupleId = User.coupleName
  
          // 커플 최근 30일 public 일기 개수
          const [coupleMonthCount] = await db.query(
            `SELECT COUNT(*) AS count 
              FROM diarytable 
              WHERE user_id = ? 
                AND privacy = 'Couple' 
                AND diary_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`,
            [coupleId]
          );
  
          // 커플 전체 public 일기 개수
          const [coupleAllCount] = await db.query(
            `SELECT COUNT(*) AS count 
             FROM diarytable 
             WHERE user_id IN (?) 
               AND privacy = 'Couple'`,
            [coupleId]
          );
  
          coupleMonth = coupleMonthCount[0].count || 0;
          coupleAll = coupleAllCount[0].count || 0;
        }
  
        // users 테이블 업데이트
        await db.query(
          `UPDATE users 
           SET month_diary = ?, all_diary = ?, 
               couple_month = ?, couple_all = ? 
           WHERE id = ?`,
          [monthDiary, allDiary, coupleMonth, coupleAll, id]
        );
  
        // 최근 30일간의 다이어리 데이터 (feeling 별로)
        const [diary] = await db.query(
          `SELECT feeling, COUNT(*) AS count 
           FROM diarytable 
           WHERE user_id = ? 
             AND privacy = 'Couple' 
             AND diary_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) 
             AND feeling IN (1, 2, 3, 4, 5)
           GROUP BY feeling
           ORDER BY feeling`,
          [id]
        );
        // 최근 30일간의 연인의 다이어리 데이터 (feeling 별로)
        const [couple_diary] = await db.query(
          `SELECT feeling, COUNT(*) AS count 
           FROM diarytable 
           WHERE user_id = ? 
             AND privacy = 'Couple' 
             AND diary_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) 
             AND feeling IN (1, 2, 3, 4, 5)
           GROUP BY feeling
           ORDER BY feeling`,
          [coupleId]
        );
        console.log("CoupleName: ", coupleId)
  
        // 다이어리 데이터를 객체로 변환
        const diaryCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        const coupleCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        diary.forEach(entry => {
          diaryCounts[entry.feeling] = entry.count;
        });
        couple_diary.forEach(entry => {
          coupleCounts[entry.feeling] = entry.count;
        });
  
        // JWT 토큰 생성
        const token = jwt.sign(
          { id: User.id, username: User.nickname },
          JWT_SECRET,
          { expiresIn: "1h" }
        );
  
        // 응답 데이터 구성
        const userInfo = {
          ...User,
          diaryCounts,
          coupleCounts,
          month_diary: monthDiary,
          all_diary: allDiary,
          couple_month: coupleMonth,
          couple_all: coupleAll,
        };
  
        console.log("Constructed User Info:", userInfo); // 디버깅 로그
        res.status(200).json({ success: true, token, user: userInfo });
      } else if (!User) {
        res.status(404).json({ success: false, message: "해당 아이디의 유저가 없습니다." });
      } else {
        res.status(401).json({ success: false, message: "비밀번호가 일치하지 않습니다." });
      }
    } catch (error) {
      console.error("Error during login:", error);
      res.status(500).json({ success: false, message: "Internal server error." });
    }
});
  

//회원가입
router.post("/register", async (req, res) => {
    const { nickname, id, password } = req.body;
  
    if (!nickname || !id || !password) {
      return res.status(400).json({ success: false, message: "All fields are required." });
    }
  
    try {
      const hashedPassword = await bcrypt.hash(password, 10); // 비밀번호 암호화
      const [result] = await db.query(
        "INSERT INTO users (nickname, id, password) VALUES (?, ?, ?)",
        [nickname, id, hashedPassword]
      );
      res.status(200).json({ success: true, message: "Welcome" });
    } catch (error) {
      console.error("Error during user registration:", error);
      res.status(500).json({ success: false, message: "Internal server error." });
    }
});


// FCM 토큰 저장 엔드포인트
router.post("/save-fcm-token", authenticateJWT, async (req, res) => {
  const { token } = req.body;
  const { id } = req.user; // JWT에서 id 가져오기

  try {
    const [result] = await db.query("UPDATE users SET fcm_token = ? WHERE id = ?", [token, id]);
    if (result.affectedRows > 0) {
      res.status(200).json({ success: true, message: "FCM token saved successfully" });
    } else {
      res.status(404).json({ success: false, message: "User not found" });
    }
  } catch (error) {
    console.error("Error saving FCM token:", error);
    res.status(500).json({ success: false, message: "Failed to save FCM token" });
  }
});

module.exports = router; 