const jwt = require('jsonwebtoken');

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

module.exports = authenticateJWT; // 모듈 내보내기
