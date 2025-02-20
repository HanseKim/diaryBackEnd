const express = require("express");
const app = express();
const http = require("http").Server(app);
const cors = require("cors");
const { normalize } = require("path");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
require('dotenv').config(); // .env 파일 로드

const { group } = require("console");
const socketIO = require("socket.io")(http, {
  cors: {
    //허용할 도메인 설정
    cors: {
      origin: "*", // or specific origin
      methods: ["GET", "POST", "DELETE"],
    },
  },
});

const db = require('./controllers/db_pool.js');
const admin = require('firebase-admin');
const cron = require('node-cron');
const authenticateJWT = require('./auth/authenticate.js');
//const authenticateSocket = require('./auth/authenticate.js')

const JWT_SECRET = process.env.JWT_SECRET;

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

// 미들웨어 설정
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// 라우터 가져오기
const loginRouter = require('./routes/login');
const mypageRouter = require('./routes/mypage');
const diaryRouter = require('./routes/diary');
const homeRouter = require('./routes/home');
const detialRouter = require('./routes/detail');

// 라우터 설정
app.use('/login', loginRouter);
app.use('/mypage', mypageRouter);
app.use('/diary', diaryRouter);
app.use('/home', homeRouter);
app.use('/detail', detialRouter);

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
    //console.log("Notification Payload:", message);

    //console.log('Successfully sent message:', response);
    return { success: true, response };
  } catch (error) {
    console.error('Error sending message:', error);
    return { success: false, error };
  }
}

// 매일 특정 시간에 알림 보내기
//"분, 시, 일, 월, 요일" 순서
cron.schedule('00 22 * * *', async () => {
  try {
    // DB에서 모든 사용자의 FCM 토큰 가져오기
    const [users] = await db.query('SELECT fcm_token FROM users WHERE fcm_token IS NOT NULL');
    //console.log("Fetched users:", users);

    for (const user of users) {
      if (user.fcm_token) {
        const result = await sendNotification(
          user.fcm_token,
          '일기 작성 시간입니다 ! 📝',
          '오늘 하루는 어떠셨나요? 소중한 추억을 기록해보세요.'
        );
        //console.log("Notification result for user:", user, result);
      }
    }
  } catch (error) {
    console.error('Error sending daily notifications:', error);
  }
}, { timezone: "Asia/Seoul" });

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


  socket.on("joinRoom", async (roomId) => {
    const uid = socket.user.id
    roomId = String(roomId);
    await socket.join(roomId);
    //console.log("joined room : ", String(roomId), " , user : ", socket.user.id);

    const group = chats.groups.find(g => g.group_id === roomId);
    if (group && group.messages.length > 0) {
      //console.log("emit to group");
      await socketIO.to(roomId).emit("new msg set", group.messages, group.messages.at(0).user);
      if (group.messages.at(0).user !== uid) {
        group.messages = [];
      }
      //console.log("after send : ", chats);
    }
  });
  // Room leave 이벤트
  socket.on("leaveRoom", (roomId) => {
    socket.leave(roomId);
    socket.disconnect(true);
    //console.log(`${socket.id} left room: ${roomId}`);
  });

  socket.on("new message", async (data, group_id, username) => {
    //console.log("message send process");
    const uid = socket.user.id
    //console.log(uid, " sended message");
    const roomSize = socketIO.sockets.adapter.rooms.get(group_id)?.size || 0;
    //console.log("room size : ", roomSize);
    if (roomSize < 2) {
      const group = chats.groups.find(g => g.group_id === group_id);

      if (group) {
        group.messages.push(data);
        
        //console.log("added to chat data");
        //console.log("result : ", group);
      } else {
        chats.groups.push({ group_id: group_id, messages: [] });
      }

      try {
        // DB에서 모든 사용자의 FCM 토큰 가져오기
        const sql = 'SELECT fcm_token FROM DiaryDB.users WHERE fcm_token IS NOT NULL AND coupleName = ' + username;
        //console.log(sql);
        const [users] = await db.query('SELECT fcm_token FROM DiaryDB.users WHERE fcm_token IS NOT NULL AND coupleName = ?', [username]);
        //console.log("Fetched users:", users);

        for (const user of users) {
          if (user.fcm_token) {
            const result = await sendNotification(
              user.fcm_token,
              '채팅 알림',
              data['text']
            );
            //console.log("Notification result for user:", user, result);
          }
        }
      } catch (error) {
        console.error('Error sending daily notifications:', error);
      }
    }
    else {
      //console.log("send : ", data);
      socket.to(group_id).emit("new msg arrive", data, uid);
    }
  });
});

app.post('/chat/list', authenticateJWT, function (req, res) {
  const { id } = req.user;
  const { group_id } = req.body;
  //console.log('from chat list, user id : ', id, " and group_id : ", group_id);
  const group = chats.groups.find((group) => group.group_id === group_id);
  //console.log('finded group : ', group);
  if (group) {
    if (group.messages.length > 0) {
      if (group.messages.at(0).user !== id) {
        res.status(200).json({ msg: group.messages });
        //console.log('send');
      }
      else res.status(200).json({ msg: [] });
    }
    else res.status(200).json({ msg: [] });
  }
  else {
    //console.log("added group to chat");
    chats.groups.push({ group_id: group_id, messages: [] });
    //console.log(chats);
    res.status(200).json({ msg: [] });
  }

});

app.post('/chat/findGroup', authenticateJWT, async function (req, res) {
  const { id } = req.user;
  try {
    const [group_id] = await db.query("SELECT group_id FROM users WHERE id = ?", [id]);
    if (group_id.length > 0) {
      //console.log('group_id : ', group_id[0].group_id);
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

app.post('/refresh/auth', authenticateJWT, async function (req, res) {
  console.log("refreshiong");
  const { id, username } = req.user;
  try {
    const token = jwt.sign(
              { id: id, username: username },
              JWT_SECRET,
              { expiresIn: "3h" }
            );
      res.status(200).json({ success: true, token : token});
  }
  catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: '서버 오류' });
  }
});

app.get("/", (req, res) => {
  res.json(chatgroups);
});

http.listen(PORT, () => {
  console.log(`Server is listeing on ${PORT}`);
});