const express = require("express");
const app = express();
const http = require("http").Server(app);
const cors = require("cors");
const { normalize } = require("path");
const jwt = require("jsonwebtoken");
const socketIO = require("socket.io")(http, {
  cors: {
    //허용할 도메인 설정
  },
});
const db = require('./controllers/db_pool.js');

//const PORT = normalize(process.env.PORT || '80');
const PORT = process.env.PORT || 80;


function createUniqueId() {
  return Math.random().toString(20).substring(2, 10);
}

let chatgroups = [];

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cors());

async function queryChatRoom(userId) {
    // query group_id from user_table by userId

    // return format
    // json
    /*
    {
        couple_img,
        couple_user_name,
        group_id,
        message_date,
        message_write_id,
        message_text,
        message_read
    }
    */
}

const JWT_SECRET = "diary app key for jwt";

// Middleware to authenticate the token
const authenticateSocket = (socket, next) => {
  const token = socket.handshake.auth.token;

  try {
    if (!token) throw new Error("Token not provided");
    const user = jwt.verify(token, JWT_SECRET);
    socket.user = user; // 사용자 정보 저장
    next();
  } catch (err) {
    next(new Error("Authentication error"));
  }
};

// 사용자와 방 관리 객체
const rooms = {}; // { roomName: [usernames...] }

socketIO.use(authenticateSocket); // JWT 인증 적용

socketIO.on("connection", (socket) => {
  console.log(`${socket.id} user is just connected`);

  socket.on("getGroup", (userId) => {
    const username = socket.user.username;
    console.log(userId);
    //socket.emit("sendGroup", queryChatRoom(userId));
    socket.emit("sendGroup", {
      couple_img : '',
      couple_user_name : 'gf',
      group_id : 'testgroup',
      message_date : '2025-01-01',
      message_write_id : username,
      message_text : '안녕',
      message_read : false,
    });
  });

  // Join Room
  socket.on("joinRoom", (roomName) => {
    const username = socket.user.username;

    // 방에 추가
    if (!rooms[roomName]) rooms[roomName] = [];
    rooms[roomName].push(username);

    socket.join(roomName);
    console.log(`${username} joined room: ${roomName}`);
  });

  socket.on("newChatMessage", (data) => {
    const { currentChatMesage, groupIdentifier, currentUser, timeData } = data;
    const filteredGroup = chatgroups.filter(
      (item) => item.id === groupIdentifier
    );
    const newMessage = {
      id: createUniqueId(),
      text: currentChatMesage,
      currentUser,
      time: `${timeData.hr}:${timeData.mins}`,
    };

    socket
      .to(filteredGroup[0].currentGroupName)
      .emit("groupMessage", newMessage);
    filteredGroup[0].messages.push(newMessage);
    socket.emit("groupList", chatgroups);
    socket.emit("foundGroup", filteredGroup[0].messages);
  });
});

app.get("/", (req, res) => {
  res.json(chatgroups);
});

// 로그인 후 JWT 저장 및 헤더 설정
app.post("/login", async (req, res) => {
  const { id, password } = req.body;
  try {
    const [user] = await db.query("SELECT * FROM users WHERE id = ?", [id]);
    const User = user[0]
    if (User && User.password === password) {
      const token = jwt.sign({ id: User.id, username: User.nickname }, JWT_SECRET, { expiresIn: '1h' });
      res.status(200).json({ success: true, token, user });
    } else {
      res.status(401).json({ success: false, message: "Invalid credentials." });
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
    const [result, field, error] = await db.query( `INSERT INTO users (nickname, id, password) VALUES (?, ?, ?)`, [nickname, id, password]);
    res.status(200).json({ success: true, message: "Welcome" });

  } catch (error) {
    console.error("Error during user registration:", error);
    res.status(500).json({ success: false, message: "Internal server error." });
  }
});

app.post("/mypage", async(req,res) =>{
  const {id} = req.body;
  try{
    const[result] = await db.query("SELECT * FROM users WHERE id = ?",[id])
    if (result.affectedRows > 0) {
      res.status(200).json({ success: true, message: "Search User successfully." });
    } else {
      res.status(404).json({ success: false, message: "User not found." });
    }
  } catch (error) {
    console.error("Error during user profile search:", error);
    res.status(500).json({ success: false, message: "Internal server error." });
  }
})

app.post("/userprofile", async (req, res) => {
  const { id, date, options } = req.body;
  try {
    const query = `UPDATE users SET date = ?, options = ? WHERE id = ?`;
    const [result] = await db.query(query, [date, options, id]);

    // 업데이트 성공 여부 확인
    if (result.affectedRows > 0) {
      res.status(200).json({ success: true, message: "User profile updated successfully." });
    } else {
      res.status(404).json({ success: false, message: "User not found." });
    }
  } catch (error) {
    console.error("Error during user profile update:", error);
    res.status(500).json({ success: false, message: "Internal server error." });
  }
});

app.post("/coupleprofile", async (req, res) => {
  const { id, coupleName } = req.body;

  try {
    // nickname으로 사용자를 조회
    const [userResult] = await db.query(
      `SELECT nickname, month_diary, all_diary FROM users WHERE nickname = ?`,
      [coupleName]
    );

    if (userResult.length === 0) {
      // 사용자가 없는 경우
      return res.status(404).json({
        success: false,
        message: "The specified user does not exist.",
      });
    }

    // 사용자가 있는 경우
    const targetUser = userResult[0];

    // coupleName 업데이트
    const [updateResult] = await db.query(
      `UPDATE users SET coupleName = ?, couple_month = ?, couple_all = ? WHERE id = ?`,
      [targetUser.nickname, targetUser.month_diary, targetUser.all_diary, id]
    );

    if (updateResult.affectedRows > 0) {
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
    console.error("Error during couple profile update:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
});


http.listen(PORT, () => {
  console.log(`Server is listeing on ${PORT}`);
});