const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../controllers/db_pool.js');
const authenticateJWT = require('../auth/authenticate.js');

// 기본 호스팅 주소 /mypage

// 유저 프로필 정보 가져오기
router.get("/:id", authenticateJWT, async (req, res) => {
    const userId = req.params.id;
  
    try {
      // 사용자 기본 정보 조회
      const [userResult] = await db.query(
        `SELECT nickname, id, date, month_diary, all_diary, coupleName, couple_month, couple_all 
         FROM users WHERE id = ?`,
        [userId]
      );
  
      if (!userResult || userResult.length === 0) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }
  
      const user = userResult[0];
  
      // 최근 30일간의 사용자 다이어리 통계 (feeling별)
      const [diary] = await db.query(
        `SELECT feeling, COUNT(*) AS count 
         FROM diarytable 
         WHERE user_id = ? 
           AND privacy = 'Couple' 
           AND diary_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
           AND feeling IN (1, 2, 3, 4, 5)
         GROUP BY feeling
         ORDER BY feeling`,
        [userId]
      );
  
      // 커플이 있는 경우 커플의 다이어리 통계도 조회
      let coupleDiary = [];
      if (user.coupleName) {
        [coupleDiary] = await db.query(
          `SELECT feeling, COUNT(*) AS count 
           FROM diarytable 
           WHERE user_id = ? 
             AND privacy = 'Couple' 
             AND diary_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
             AND feeling IN (1, 2, 3, 4, 5)
           GROUP BY feeling
           ORDER BY feeling`,
          [user.coupleName]
        );
      }
  
      // 다이어리 통계 데이터를 객체로 변환
      const diaryCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      const coupleCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  
      diary.forEach(entry => {
        diaryCounts[entry.feeling] = entry.count;
      });
  
      coupleDiary.forEach(entry => {
        coupleCounts[entry.feeling] = entry.count;
      });
  
      // 최신 일기 통계 업데이트
      const [monthDiaryCount] = await db.query(
        `SELECT COUNT(*) AS count 
         FROM diarytable 
         WHERE user_id = ? 
           AND privacy = 'Couple' 
           AND diary_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`,
        [userId]
      );
  
      const [allDiaryCount] = await db.query(
        `SELECT COUNT(*) AS count 
         FROM diarytable 
         WHERE user_id = ? AND privacy = 'Couple'`,
        [userId]
      );
  
      // 커플 일기 통계
      let coupleMonth = 0;
      let coupleAll = 0;
      if (user.coupleName) {
        const [coupleMonthCount] = await db.query(
          `SELECT COUNT(*) AS count 
           FROM diarytable 
           WHERE user_id = ? 
             AND privacy = 'Couple' 
             AND diary_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`,
          [user.coupleName]
        );
  
        const [coupleAllCount] = await db.query(
          `SELECT COUNT(*) AS count 
           FROM diarytable 
           WHERE user_id = ? AND privacy = 'Couple'`,
          [user.coupleName]
        );
  
        coupleMonth = coupleMonthCount[0].count || 0;
        coupleAll = coupleAllCount[0].count || 0;
      }
  
      // DB 업데이트
      await db.query(
        `UPDATE users 
         SET month_diary = ?, all_diary = ?, 
             couple_month = ?, couple_all = ? 
         WHERE id = ?`,
        [monthDiaryCount[0].count, allDiaryCount[0].count, coupleMonth, coupleAll, userId]
      );
  
      // 응답 데이터 구성
      const userInfo = {
        ...user,
        diaryCounts,
        coupleCounts,
        month_diary: monthDiaryCount[0].count,
        all_diary: allDiaryCount[0].count,
        couple_month: coupleMonth,
        couple_all: coupleAll
      };
  
      res.status(200).json({
        success: true,
        message: "Successfully retrieved user profile",
        userInfo
      });
  
    } catch (error) {
      console.error("Error fetching user profile:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error"
      });
    }
});
  
  // 마이페이지에서 유저 정보 수정
router.post("/all", authenticateJWT, async (req, res) => {
    const { nickname, id, date, coupleName, month_diary, all_diary } = req.body;
    try {
      // nickname으로 사용자를 조회
      const [userResult] = await db.query(
        `SELECT nickname, month_diary, all_diary, coupleName FROM users WHERE nickname = ?`,
        [coupleName]
      );
  
      if (!userResult || userResult.length === 0) {
        console.log("User not found:", coupleName); // 디버깅용 로그
        return res.status(404).json({
          success: false,
          message: "The specified user does not exist.",
        });
      }
  
      // 사용자가 있는 경우
      const targetUser = userResult[0];
  
      if (targetUser.coupleName != null) {
        console.log("Already a couple:", targetUser.coupleName); // 디버깅용 로그
        return res.status(404).json({
          success: false,
          message: "already couple",
        });
      }
  
      // coupleName 업데이트
      const [updateResult] = await db.query(
        `UPDATE users SET date = ?, coupleName = ?, couple_month = ?, couple_all = ?, group_id = ? WHERE id = ?`,
        [date,targetUser.nickname, targetUser.month_diary, targetUser.all_diary, `${nickname}${targetUser.nickname}`, id]
      );
      const [updateResult2] = await db.query(
        `UPDATE users SET date = ?, coupleName = ?, couple_month =?, couple_all = ?, group_id = ? WHERE nickname = ?`,
        [date, nickname, month_diary, all_diary, `${nickname}${targetUser.nickname}`, targetUser.nickname]
      );
  
  
      if (updateResult.affectedRows > 0 && updateResult2.affectedRows > 0) {
        return res.status(200).json({
          success: true,
          message: "Couple profile updated successfully.",
          coupleName: targetUser.nickname,
          month_diary: targetUser.month_diary,
          all_diary: targetUser.all_diary,
        });
      } else {
        return res.status(404).json({
          success: false,
          message: "User not found.",
        });
      }
    } catch (error) {
      console.error("Error during user profile update:", error);
      res.status(500).json({ success: false, message: "Internal server error." });
    }
});
  
  // 마이페이지에서 유저 정보 수정
router.post("/date", authenticateJWT, async (req, res) => {
const { id, date } = req.body;
try {
    // nickname으로 사용자를 조회
    const [userResult] = await db.query(
    `SELECT nickname, month_diary, all_diary, coupleName FROM users WHERE id = ?`,
    [id]
    );

    // 사용자가 있는 경우
    const targetUser = userResult[0];

    const [updateResult] = await db.query(
    `UPDATE users SET date = ? WHERE id = ?`,
    [date, id]
    );

    let updateResult2;
    if(targetUser.coupleName != null){
    [updateResult2] = await db.query(
        `UPDATE users SET date = ? WHERE nickname = ?`,
        [date, targetUser.coupleName]
    );
    }

    if (updateResult.affectedRows > 0 && (updateResult2 ? updateResult2.affectedRows > 0 : true)) {
    return res.status(200).json({
        success: true,
        message: "UserDate updated successfully."
    });
    } else {
    return res.status(404).json({
        success: false,
        message: "User not found.",
    });
    }
} catch (error) {
    console.error("Error during user profile update:", error);
    res.status(500).json({ success: false, message: "Internal server error." });
}
});

// 커플 관계 삭제
router.post("/delete-couple", authenticateJWT, async (req, res) => {
    const { id } = req.user; // JWT에서 현재 사용자 ID 가져오기

    try {
        // 현재 사용자의 커플 정보 조회
        const [userResult] = await db.query(
        "SELECT coupleName FROM users WHERE id = ?",
        [id]
        );

        if (!userResult || userResult.length === 0) {
        return res.status(404).json({
            success: false,
            message: "User not found"
        });
        }

        const coupleName = userResult[0].coupleName;

        if (!coupleName) {
        return res.status(400).json({
            success: false,
            message: "No couple relationship exists"
        });
        }

        // 현재 사용자와 커플의 정보 모두 초기화
        const updates = await Promise.all([
        // 현재 사용자의 커플 관련 정보 초기화
        db.query(
            `UPDATE users 
              SET coupleName = NULL, 
                  date = NULL,
                  couple_month = NULL, 
                  couple_all = NULL, 
                  group_id = NULL 
            WHERE id = ?`,
            [id]
        ),
        // 상대방의 커플 관련 정보 초기화
        db.query(
            `UPDATE users 
              SET coupleName = NULL, 
                  date = NULL,
                  couple_month = NULL, 
                  couple_all = NULL, 
                  group_id = NULL 
              WHERE nickname = ?`,
            [coupleName]
        )
        ]);

        res.status(200).json({
        success: true,
        message: "Couple relationship has been deleted successfully"
        });

    } catch (error) {
        console.error("Error deleting couple relationship:", error);
        res.status(500).json({
        success: false,
        message: "Internal server error"
        });
    }
});

module.exports = router; 