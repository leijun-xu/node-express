import { PrismaClient } from '@prisma/client';
import express from 'express';

const prisma = new PrismaClient();
const router = express.Router();

// GET /users - 获取所有用户
router.get('/', async (req, res) => {
  const data = await prisma.user.findMany({
    include: {
      // posts: true, // 包含用户的文章
    },
  });
  // 这里可以从数据库获取用户数据
  res.send(data);
});

// POST /users - 创建新用户
router.post('/create', async (req, res) => {
  const { name, email } = req.body;
  const data = await prisma.user.create({
    data: {
      name,
      email,
      // posts: {
      //   create: [
      //     {
      //       title: "第一篇文章",
      //       content: "这是第一篇文章的内容",
      //     },
      //     {
      //       title: "第二篇文章",
      //       content: "这是第二篇文章的内容",
      //     }
      //   ]
      // }
    }
  });
  // 这里可以保存到数据库
  res.send(data);
});

// PUT /users/:id - 更新特定用户
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, email } = req.body;
  const data = await prisma.user.update({
    where: { id: Number(id) },
    data: {
      name,
      email,
    },
  });
  res.send(data);
});

// GET /users/:id - 获取特定用户
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const data = await prisma.user.findUnique({
    where: { id: Number(id) },
    // include: {  posts: true }, // 包含用户的文章
  });
  // 这里可以从数据库获取特定用户
  res.send(data);
});

// DELETE /users/:id - 删除特定用户
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const data = await prisma.user.delete({
      where: { id: Number(id) },
    });

    res.json({
      message: '用户删除成功',
      deletedUser: data
    });
  } catch (error) {
    console.error('删除用户失败:', error);
    res.status(500).json({
      message: '删除用户失败',
    });
  }
});


export default router;