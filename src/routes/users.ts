import { PrismaClient } from '@prisma/client';
import express from 'express';
import fs from "node:fs";
import yaml from "js-yaml";
import nodemailer from "nodemailer";

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
  await prisma.user.create({
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
  // send email
  const emailConfig = yaml.load(fs.readFileSync("email.yaml", "utf-8")) as { user: string; pass: string };

  const transporter = nodemailer.createTransport({
    service: "qq",
    host: "smtp.qq.com",
    port: 465,
    secure: true,
    auth: {
      user: emailConfig.user,
      pass: emailConfig.pass, // QQ邮箱需要使用授权码，不是登录密码
    },
  });

  try {
    // 验证连接
    await transporter.verify();
    console.log("SMTP服务器连接成功");

    const info = await transporter.sendMail({
      from: `"系统通知" <${emailConfig.user}>`,
      to: email,
      subject: "欢迎注册",
      text: `你好 ${name}，欢迎注册我们的服务！`,
      html: `<h1>欢迎注册</h1><p>你好 ${name}，欢迎注册我们的服务！</p>`,
    });

    console.log("邮件发送成功:", info.messageId);
    res.send('邮件发送成功');
  } catch (error) {
    console.error("邮件发送失败:", error);
    res.status(500).send('邮件发送失败');
  }


  // let data2 = ''
  // req.on('data', chunk => {
  //   data2 += chunk;
  // });

  // req.on('end', () => {
  //   const { to } = JSON.parse(data2);
  //   transporter.sendMail({
  //     from: emailConfig.user,
  //     to,
  //     subject: "欢迎注册",
  //     text: `你好 ${name}，欢迎注册我们的服务！`,
  //   });
  //   // 这里可以保存到数据库
  //   res.send('ok');
  // })
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