const express = require("express");
const app = express();
const http = require("http").Server(app);
const cors = require("cors");
const { normalize } = require("path");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const { group } = require("console");
const socketIO = require("socket.io")(http, {
  cors: {
    //허용할 도메인 설정
    cors: {
      origin: "*", // or specific origin
      methods: ["GET", "POST"],
    },
  },
});
const db = require('./controllers/db_pool.js');
const admin = require('firebase-admin');
const cron = require('node-cron');

// Firebase Admin 초기화
const serviceAccount = require('./firebase-service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

//const PORT = normalize(process.env.PORT || '80');
const PORT = process.env.PORT || 80;

function createUniqueId() {
  return Math.random().toString(20).substring(2, 10);
}

function createUniqueId() {
  return Math.random().toString(20).substring(2, 10);
}

let chatgroups = [];

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cors());

// Nofitication 함수화
async function sendNotification(token, title, body) {
  const message = {
    notification: {
      title,
      body,
    },
    android: {
      priority: 'high',
      notification: {
        sound: 'default',
        priority: 'high',
        channelId: 'default',
        visibility: 'public'
      },
    },
    apns: {
      payload: {
        aps: {
          sound: 'default',
          badge: 1,
        },
      },
    },
    token,
  };

  try {
    const response = await admin.messaging().send(message);
    console.log("Notification Payload:", message);

    console.log('Successfully sent message:', response);
    return { success: true, response };
  } catch (error) {
    console.error('Error sending message:', error);
    return { success: false, error };
  }
}

// 매일 특정 시간에 알림 보내기
//"분, 시, 일, 월, 요일" 순서
cron.schedule('51 23 * * *', async () => {
  try {
    // DB에서 모든 사용자의 FCM 토큰 가져오기
    const [users] = await db.query('SELECT fcm_token FROM users WHERE fcm_token IS NOT NULL');
    console.log("Fetched users:", users);

    for (const user of users) {
      if (user.fcm_token) {
        const result = await sendNotification(
          user.fcm_token,
          '일기 작성 시간입니다 ! 📝',
          '오늘 하루는 어떠셨나요? 소중한 추억을 기록해보세요.'
        );
        console.log("Notification result for user:", user, result);
      }
    }
  } catch (error) {
    console.error('Error sending daily notifications:', error);
  }
}, { timezone: "Asia/Seoul" });

//토큰이 유효한지 확인하는 미들웨어
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ success: false, message: "Access token is required" });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ success: false, message: "Invalid token" });
    req.user = user;
    next();
  });
};

// FCM 토큰 저장 엔드포인트
app.post("/save-fcm-token", authenticateToken, async (req, res) => {
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

const JWT_SECRET = "diary app key for jwt";

// Middleware to authenticate the token In router
const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (authHeader) {
    const token = authHeader.split(" ")[1]; // Bearer 토큰에서 실제 토큰만 추출

    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (err) {
        return res.sendStatus(403); // 유효하지 않은 토큰
      }
      req.user = user; // 사용자 정보를 req 객체에 저장
      next();
    });
  } else {
    res.sendStatus(401); // 인증 헤더가 없음
  }
};

// Middleware to authenticate the token In Socket
const authenticateSocket = (socket, next) => {
  const token = socket.handshake.auth.token;
  try {
    if (!token) {
      throw new Error("Token not provided");
    }
    const user = jwt.verify(token, JWT_SECRET);
    socket.user = user; // 사용자 정보 저장
    next();
  } catch (err) {
    next(new Error("Authentication error"));
  }
};

// 사용자와 방 관리 객체
const rooms = {}; // { roomName: [usernames...] }

const chats = {
  groups: [
    { group_id: 'testgroup', messages: [{ id: '1234', user: 'test2', text: 'hello socket', date: "2025-01-01" }, { id: '12345', user: 'test2', text: 'hello socket', date: "2025-01-01" }] },
  ],
};
socketIO.use(authenticateSocket); // JWT 인증 적용

socketIO.on("connection", (socket) => {
  console.log(`${socket.user.id} user is just connected`);

  app.get('/test/send', function (req, res) {
    const { roomId } = req.body;
    const roomSize = socketIO.sockets.adapter.rooms.get(roomId)?.size || 0;
    if (roomSize < 2) {
      const group = chats.groups.find(g => g.group_id === roomId);

      if (group) {
        group.messages.push({ id: '14', user: 'test2', text: 'hello socket', date: "2025-01-01" });
      } else {
        console.error(`Group with id "${roomId}" not found`);
      }
    }
    else {
      socketIO.to(roomId).emit("new msg arrive", { id: '34', user: 'test2', text: 'hello socket', date: "2025-01-01" });
    }
    res.json({ success: true });
  });

  async function sendRoomChat(roomId) {
    const group = chats.groups.find((group) => group.group_id === roomId);
    try {

      await socketIO.in(group.group_id).emit("cccc", { data: group.messages });
      console.log("successfully send chat");
    } catch (error) {
      console.error("Error sending message:", error);
    }
  }

  socket.on("joinRoom", async (roomId) => {

    roomId = String(roomId);
    socket.join(roomId);

    const group = chats.groups.find((group) => group.group_id === roomId);
    if (group) {
      if (group.messages.length > 0) {
        console.log(group.messages.at(0).user, ' and ', socket.user.id)
        if (group.messages.at(0).user !== socket.user.id) {
          socketIO.in(group.group_id).emit("cccc", { data: group.messages });
          group.messages = [];
          console.log('send');
        }
      }
    }
    else {
      chats.groups.push({ group_id: roomId, messages: [] });
    }
  });

  // Room leave 이벤트
  socket.on("leaveRoom", (roomId) => {
    socket.leave(roomId);
    console.log(`${socket.id} left room: ${roomId}`);
  });

  socket.on("new message", (data, group_id) => {

    const roomSize = socketIO.sockets.adapter.rooms.get(group_id)?.size || 0;
    if (roomSize < 2) {
      const group = chats.groups.find(g => g.group_id === group_id);

      if (group) {
        group.messages.push(data);
      } else {
        console.error(`Group with id "${group_id}" not found`);
      }
    }
    else {
      socketIO.to(group_id).emit("new msg arrive", data);
    }
  });
});

app.post('/chat/list', authenticateJWT, function (req, res) {
  const { id } = req.user;
  const { group_id } = req.body;
  console.log('chat list id : ', id, "group_id: ", group_id);
  const group = chats.groups.find((group) => group.group_id === group_id);

  if (group) {
    if (group.messages.length > 0) {
      if (group.messages.at(0).user !== id) {

        res.status(200).json({ msg: group.messages });
        console.log('send');
      }
    }
  }
  else {
    res.status(400);
  }
});

app.post('/chat/findGroup', authenticateJWT, async function (req, res) {
  const { id } = req.user;
  try {
    const [group_id] = await db.query("SELECT group_id FROM users WHERE id = ?", [id]);
    if (group_id.length > 0) {
      console.log('group_id : ', group_id[0].group_id);
      if (group_id[0].group_id == null) {
        res.status(200).json({ success: false, result: "" });
      }
      else {
        res.status(200).json({ success: true, result: group_id[0].group_id });
      }
    }
    else {
      res.status(200).json({ success: false, result: '' });
    }
  }
  catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: '서버 오류' });
  }
});

app.get("/", (req, res) => {
  res.json(chatgroups);
});

app.post('/Detail', async (req, res) => {
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

app.post('/Home', async (req, res) => {
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


//자동로그인
/*
app.post('/verify-token', async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ 
      success: false, 
      message: "Token and ID are required" 
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.id; // 혹은 decoded.id 등 실제 필드명 사용
    const [user] = await db.query("SELECT * FROM users WHERE id = ?", [userId]);

    if (!user || user.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // 모든 검증을 통과하면 성공 응답
    res.status(200).json({ 
      success: true, 
      message: "Token is valid",
      user: user[0], 
    });

  } catch (error) {
    console.error("Token verification error:", error);
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false, 
        message: "Token has expired" 
      });
    }
    
    res.status(401).json({ 
      success: false, 
      message: "Invalid token" 
    });
  }
});
*/

//로그인
app.post("/login", async (req, res) => {
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
app.post("/register", async (req, res) => {
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


// diaryScreen 엔드포인트
app.post('/write-diary', async (req, res) => {
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
app.post("/search-diary", async (req, res) => {
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
app.post("/edit-search", async (req, res) => {
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

//수정데이터 업로드
app.post("/write-diary", async (req, res) => {
  const { title, id, user_id, content, feeling, privacy, diary_date } = req.body;
  const query = `INSERT INTO diarytable (title, user_id, content, feeling, privacy, diary_date) VALUES (?, ?, ?, ?, ?, ?)`;

  try {
    console.log("update try");
    const [results] = await db.query(query, [title, user_id, content, feeling, privacy, diary_date, id]); // Promise 기반 사용
    console.log("update Results:", results);
    res.status(200).json(results[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update data into diarytable" });
  }
});

//UPDATE
app.post("/edit-diary", async (req, res) => {
  const { title, id, user_id, content, feeling, privacy, diary_date } = req.body;
  const query = `UPDATE diarytable SET title = ?, user_id = ?,content = ?, feeling = ?, privacy = ?, diary_date = ? WHERE id = ?`;

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

// 유저 프로필 정보 가져오기
app.get("/userprofile/:id", authenticateToken, async (req, res) => {
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
app.post("/userprofile", authenticateToken, async (req, res) => {
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

// 커플 관계 삭제
app.post("/delete-couple", authenticateToken, async (req, res) => {
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

http.listen(PORT, () => {
  console.log(`Server is listeing on ${PORT}`);
});