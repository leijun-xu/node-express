import { Request, Response, NextFunction } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { logger } from '../utils/logger.js';

// 统一响应格式工具函数
const sendResponse = (res: any, code: number, message: string, data: any = null) => {
  res.status(code >= 400 ? code : 200).json({
    code,
    message,
    data
  });
};

// 扩展 Request 类型，添加 user 属性
export interface AuthRequest extends Request {
  user?: JwtPayload | string;
}

/**
 * JWT 认证中间件
 * @param secretKey - JWT 密钥
 * @returns 中间件函数
 */
export const verifyToken = (secretKey: string) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      console.log('authHeader:', JSON.stringify(req.headers)); // 调试输出 Authorization 头
      
      // 检查 Authorization 头是否存在
      if (!authHeader) {
        logger.warn('token 验证失败 - 没有提交 token');
        return sendResponse(res, 403, '没有提交 token');
      }

      // 从 "Bearer <token>" 格式中提取 token
      const token = authHeader.startsWith('Bearer ') 
        ? authHeader.slice(7) 
        : authHeader;

      // 验证并解密 token，返回值：string | JwtPayload（不会是 null）
      const decoded = jwt.verify(token, secretKey) as JwtPayload;
      logger.debug(`token 验证成功 - userId: ${decoded?.id}`);
      req.user = decoded;
      next();
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        logger.warn('token 验证失败 - token已过旧');
        return sendResponse(res, 403, 'token已过旧');
      }
      logger.warn(`token 验证失败 - token无效 - ${error}`);
      return sendResponse(res, 403, 'token无效');
    }
  };
};
