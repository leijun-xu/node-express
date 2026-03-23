import express from 'express';
import usersRouter from './routes/users.js';

const app = express();
const port = process.env.PORT || 3000;

// 使用JSON中间件
app.use(express.json());

// 引入users路由
app.use('/users', usersRouter);

// 根路由
app.get('/', (req, res) => {
  res.send('Hello, Express!');
});

// 启动服务器
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});