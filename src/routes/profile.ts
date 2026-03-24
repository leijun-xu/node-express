import { PrismaClient } from '@prisma/client';
import express from 'express';
import { logger } from '../utils/logger.js';
import { sendProfileUpdateEmail } from '../services/emailService.js';

const prisma = new PrismaClient();
const router = express.Router();

// GET /profile - 获取当前用户信息
router.get('/', async (req: any, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true
      }
    });

    if (!user) {
      logger.warn(`获取用户信息失败 - 用户不存在 - userId: ${req.user.id}`);
      return res.status(404).json({
        code: 404,
        message: '用户不存在',
        data: null
      });
    }

    logger.info(`获取用户信息成功 - userId: ${req.user.id}`);
    res.json({
      code: 200,
      message: '获取用户信息成功',
      data: user
    });
  } catch (error) {
    logger.error(`获取用户信息异常: ${error}`);
    res.status(500).json({
      code: 500,
      message: '获取用户信息失败',
      data: null
    });
  }
});

// PUT /profile - 更新当前用户信息
router.put('/', async (req: any, res) => {
  try {
    const { email, firstName, lastName } = req.body;

    // 验证输入
    if (!email) {
      logger.warn(`更新用户信息失败 - 邮箱为空 - userId: ${req.user.id}`);
      return res.status(400).json({
        code: 400,
        message: '邮箱不能为空',
        data: null
      });
    }

    // 检查邮箱是否已被其他用户使用
    const existingUser = await prisma.user.findFirst({
      where: {
        email,
        NOT: { id: req.user.id }
      }
    });

    if (existingUser) {
      logger.warn(`更新用户信息失败 - 邮箱已被使用 - email: ${email}`);
      return res.status(400).json({
        code: 400,
        message: '邮箱已被使用',
        data: null
      });
    }

    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        email,
        firstName,
        lastName
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true
      }
    });

    logger.info(`用户信息更新成功 - userId: ${req.user.id} - email: ${email}`);
    
    // 发送邮件通知
    await sendProfileUpdateEmail(email, firstName || updatedUser.firstName, lastName || updatedUser.lastName);

    res.json({
      code: 200,
      message: '用户信息更新成功',
      data: updatedUser
    });
  } catch (error) {
    logger.error(`更新用户信息异常: ${error}`);
    res.status(500).json({
      code: 500,
      message: '更新用户信息失败',
      data: null
    });
  }
});

export default router;