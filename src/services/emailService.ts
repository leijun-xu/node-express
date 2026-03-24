import nodemailer from 'nodemailer';
import fs from 'node:fs';
import yaml from 'js-yaml';
import { logger } from '../utils/logger.js';

// 邮件配置缓存
let emailConfigCache: { user: string; pass: string } | null = null;

/**
 * 获取邮件配置
 */
const getEmailConfig = () => {
  if (!emailConfigCache) {
    emailConfigCache = yaml.load(fs.readFileSync("email.yaml", "utf-8")) as { user: string; pass: string };
  }
  return emailConfigCache;
};

/**
 * 创建邮件传输器
 */
const createTransporter = () => {
  const emailConfig = getEmailConfig();
  return nodemailer.createTransport({
    service: "qq",
    host: "smtp.qq.com",
    port: 465,
    secure: true,
    auth: {
      user: emailConfig.user,
      pass: emailConfig.pass,
    },
  });
};

/**
 * 发送欢迎邮件（注册时）
 * @param email - 收件人邮箱
 * @param firstName - 用户名
 * @param lastName - 用户姓氏
 */
export const sendWelcomeEmail = async (email: string, firstName: string, lastName: string) => {
  try {
    const emailConfig = getEmailConfig();
    const transporter = createTransporter();

    // 验证连接
    await transporter.verify();
    logger.debug("SMTP服务器连接成功");

    const info = await transporter.sendMail({
      from: `"系统通知" <${emailConfig.user}>`,
      to: email,
      subject: "欢迎注册",
      text: `你好，欢迎注册我们的服务！`,
      html: `<h1>欢迎注册</h1><p>你好，${firstName} ${lastName}，欢迎注册我们的服务！</p>`,
    });

    logger.info(`欢迎邮件发送成功 - email: ${email} - messageId: ${info.messageId}`);
    return true;
  } catch (error) {
    logger.error(`欢迎邮件发送失败 - email: ${email} - error: ${error}`);
    return false;
  }
};

/**
 * 发送个人信息更新成功通知邮件
 * @param email - 收件人邮箱
 * @param firstName - 用户名
 * @param lastName - 用户姓氏
 */
export const sendProfileUpdateEmail = async (email: string, firstName: string, lastName: string) => {
  try {
    const emailConfig = getEmailConfig();
    const transporter = createTransporter();

    // 验证连接
    await transporter.verify();
    logger.debug("SMTP服务器连接成功");

    const info = await transporter.sendMail({
      from: `"系统通知" <${emailConfig.user}>`,
      to: email,
      subject: "个人信息更新成功",
      text: `你好，你的个人信息已成功更新！`,
      html: `
        <h1>个人信息更新成功</h1>
        <p>你好，${firstName} ${lastName}！</p>
        <p>你的个人信息已成功更新。如有任何疑问，请联系我，${emailConfig.user}。</p>
        <hr />
        <p style="color: #666; font-size: 12px;">此为系统自动发送的邮件，请勿回复</p>
      `,
    });

    logger.info(`个人信息更新通知邮件发送成功 - email: ${email} - messageId: ${info.messageId}`);
    return true;
  } catch (error) {
    logger.error(`个人信息更新通知邮件发送失败 - email: ${email} - error: ${error}`);
    return false;
  }
};

/**
 * 发送通用邮件
 * @param email - 收件人邮箱
 * @param subject - 邮件主题
 * @param htmlContent - HTML内容
 */
export const sendEmail = async (email: string, subject: string, htmlContent: string) => {
  try {
    const emailConfig = getEmailConfig();
    const transporter = createTransporter();

    // 验证连接
    await transporter.verify();
    logger.debug("SMTP服务器连接成功");

    const info = await transporter.sendMail({
      from: `"系统通知" <${emailConfig.user}>`,
      to: email,
      subject,
      html: htmlContent,
    });

    logger.info(`通用邮件发送成功 - email: ${email} - subject: ${subject} - messageId: ${info.messageId}`);
    return true;
  } catch (error) {
    logger.error(`通用邮件发送失败 - email: ${email} - subject: ${subject} - error: ${error}`);
    return false;
  }
};
