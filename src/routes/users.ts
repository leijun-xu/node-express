import { PrismaClient } from '@prisma/client';
import express from 'express';
import { logger } from '../utils/logger.js';

const prisma = new PrismaClient();
const router = express.Router();

// GET /users - 获取所有用户（排除密码）
router.get('/', async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true
      }
    });
    logger.info('获取用户列表成功');
    res.json({
      code: 200,
      message: '获取用户列表成功',
      data: users
    });
  } catch (error) {
    logger.error(`获取用户列表异常: ${error}`);
    res.status(500).json({
      code: 500,
      message: '获取用户列表失败',
      data: null
    });
  }
});

// PUT /users/:id - 更新特定用户（支持更新所有字段）
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { email, firstName, lastName } = req.body;

    // 验证输入
    if (!email) {
      logger.warn(`更新用户失败 - 邮箱为空 - userId: ${id}`);
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
        NOT: { id: Number(id) }
      }
    });

    if (existingUser) {
      logger.warn(`更新用户失败 - 邮箱已被使用 - email: ${email}`);
      return res.status(400).json({
        code: 400,
        message: '邮箱已被使用',
        data: null
      });
    }

    const updatedUser = await prisma.user.update({
      where: { id: Number(id) },
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

    logger.info(`用户更新成功 - userId: ${id} - email: ${email}`);
    res.json({
      code: 200,
      message: '用户更新成功',
      data: updatedUser
    });
  } catch (error) {
    logger.error(`更新用户异常: ${error}`);
    res.status(500).json({
      code: 500,
      message: '更新用户失败',
      data: null
    });
  }
});

// GET /users/:id - 获取特定用户（排除密码）
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const user = await prisma.user.findUnique({
      where: { id: Number(id) },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true
      }
    });

    if (!user) {
      logger.warn(`获取用户失败 - 用户不存在 - userId: ${id}`);
      return res.status(404).json({
        code: 404,
        message: '用户不存在',
        data: null
      });
    }

    logger.info(`获取用户成功 - userId: ${id}`);
    res.json({
      code: 200,
      message: '获取用户成功',
      data: user
    });
  } catch (error) {
    logger.error(`获取用户异常: ${error}`);
    res.status(500).json({
      code: 500,
      message: '获取用户失败',
      data: null
    });
  }
});

// DELETE /users/:id - 删除特定用户
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deletedUser = await prisma.user.delete({
      where: { id: Number(id) },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true
      }
    });

    logger.info(`用户删除成功 - userId: ${id}`);
    res.json({
      code: 200,
      message: '用户删除成功',
      data: deletedUser
    });
  } catch (error) {
    logger.error(`删除用户异常: ${error}`);
    res.status(500).json({
      code: 500,
      message: '删除用户失败',
      data: null
    });
  }
});

export default router;