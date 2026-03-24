import express from 'express';
import usersRouter from './routes/users.js';
import profileRouter from './routes/profile.js';
import jwt from "jsonwebtoken";
import cors from "cors";
import { PrismaClient } from '@prisma/client';
import { verifyToken } from './middleware/auth.js';
import { logger } from './utils/logger.js';
import { sendWelcomeEmail } from './services/emailService.js';

const prisma = new PrismaClient();
const secretKey = process.env.SECRET_KEY!; // 这个密钥应该保存在环境变量中
const app = express();
const port = process.env.PORT || 8080;

// 统一响应格式工具函数
const sendResponse = (res: any, code: number, message: string, data: any = null) => {
  res.status(code >= 400 ? code : 200).json({
    code,
    message,
    data
  });
};

// 确保 SECRET_KEY 已设置
if (!secretKey) {
  throw new Error('SECRET_KEY environment variable is not set');
}

// 使用JSON中间件
app.use(express.json());
app.use(cors());

// 根路由
app.get('/health', (req, res) => {
  sendResponse(res, 200, 'API 服务运行正常', {
    version: '1.0.0',
    description: 'Node.js + Express + Prisma 用户管理系统'
  });
});

// login路由（无需认证）
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // 验证输入
    if (!email || !password) {
      logger.warn('登录失败 - 邮箱或密码为空');
      return res.status(400).json({
        code: 400,
        message: '邮箱和密码不能为空',
        data: null
      });
    }

    // 查询用户：只支持用email登录
    const user = await prisma.user.findUnique({
      where: { email }
    });

    // 用户不存在
    if (!user) {
      logger.warn(`登录失败 - 用户不存在 - email: ${email}`);
      return res.status(401).json({
        code: 401,
        message: '邮箱或密码错误',
        data: null
      });
    }

    // 验证密码
    if (user.password !== password) {
      logger.warn(`登录失败 - 密码错误 - email: ${email}`);
      return res.status(401).json({
        code: 401,
        message: '邮箱或密码错误',
        data: null
      });
    }

    // 生成 JWT token，包含用户id，过期时间1小时
    const token = jwt.sign(
      { id: user.id },
      secretKey,
      { expiresIn: '1h' }
    );

    // 返回token和用户信息（排除密码）
    const { password: _, ...userWithoutPassword } = user;
    logger.info(`用户登录成功 - email: ${email}`);
    res.json({
      code: 200,
      message: '登录成功',
      data: {
        requestToken:token,
        expiresIn: 3600, // 1小时
        user: userWithoutPassword
      }
    });
  } catch (error) {
    logger.error(`登录异常: ${error}`);
    res.status(500).json({
      code: 500,
      message: '登录失败',
      data: null
    });
  }
});

// 注册路由（无需认证）
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, firstName, lastName } = req.body;

    // 验证输入
    if (!email || !password) {
      logger.warn('注册失败 - 邮箱或密码为空');
      return res.status(400).json({
        code: 400,
        message: '邮箱和密码不能为空',
        data: null
      });
    }

    // 检查邮箱是否已存在
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      logger.warn(`注册失败 - 邮箱已存在 - email: ${email}`);
      return res.status(409).json({
        code: 409,
        message: '邮箱已被注册',
        data: null
      });
    }

    // 创建新用户
    const newUser = await prisma.user.create({
      data: {
        email,
        password, // 注意：生产环境应该加密密码
        firstName: firstName || '',
        lastName: lastName || ''
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true
      }
    });

    // 发送欢迎邮件
    await sendWelcomeEmail(email, firstName || '', lastName || '');

    logger.info(`用户注册成功 - email: ${email}`);
    res.status(201).json({
      code: 201,
      message: '注册成功',
      data: newUser
    });
  } catch (error) {
    logger.error(`注册异常: ${error}`);
    res.status(500).json({
      code: 500,
      message: '注册失败',
      data: null
    });
  }
});

// 应用 JWT 认证中间件到后续所有路由
app.use('/api', verifyToken(secretKey));

// 引入users路由（受保护）
app.use('/api/users', usersRouter);

// 引入profile路由（受保护）
app.use('/api/profile', profileRouter);

// 启动服务器
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});