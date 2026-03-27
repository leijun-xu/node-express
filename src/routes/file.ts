import express from "express";
import { logger } from "@/utils/logger.js";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import multer from "multer";

const router = express.Router();

// 配置multer用于文件上传（使用内存存储）
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 单个分片最大10MB
    fieldSize: 10 * 1024 * 1024, // 字段大小限制
    fields: 10, // 字段数量限制
    files: 1, // 文件数量限制
  },
  fileFilter: (req, file, cb) => {
    logger.info("Multer fileFilter 被调用");
    logger.info("file:", file);
    cb(null, true);
  },
});

// 临时分片存储目录
const CHUNKS_DIR = path.join(process.cwd(), "uploads", "chunks");
// 最终文件存储目录
const UPLOAD_DIR = path.join(process.cwd(), "uploads", "files");

// 确保目录存在
async function ensureDirs() {
  await fs.mkdir(CHUNKS_DIR, { recursive: true });
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
}

// 初始化目录
ensureDirs();

// 响应格式化工具
const sendResponse = (
  res: any,
  code: number,
  message: string,
  data: any = null,
) => {
  res.status(code >= 400 ? code : 200).json({
    code,
    message,
    data,
  });
};

/**
 * 上传文件分片
 * POST /api/file/upload
 * Body: multipart/form-data
 * - file: 分片文件
 * - chunkIndex: 分片索引 (0-based)
 * - totalChunks: 总分片数
 * - fileId: 文件唯一标识 (MD5)
 * - fileName: 原始文件名
 * - fileSize: 文件总大小
 */
router.post("/upload", upload.single("file"), async (req: any, res) => {
  try {
    // 这里前端传过来的是formdata格式，使用multer中间件解析后，文件会在req.file中，其他字段在req.body中，所以我们需要从req.body中获取chunkIndex、totalChunks、fileId、fileName、fileSize等参数
    const { chunkIndex, totalChunks, fileId, fileName, fileSize } =
      req.body || {};
    const file = req.file;

    // 参数校验
    if (
      !file ||
      chunkIndex === undefined ||
      !totalChunks ||
      !fileId ||
      !fileName
    ) {
      logger.warn("缺少必要参数", {
        hasFile: !!file,
        chunkIndex,
        totalChunks,
        fileId,
        fileName,
        fileSize,
      });
      return sendResponse(res, 400, "缺少必要参数");
    }

    // 验证文件大小
    const chunkSize = parseInt(fileSize) / parseInt(totalChunks);
    if (file.size > 10 * 1024 * 1024) {
      logger.warn(
        `分片过大 - fileId: ${fileId}, chunkSize: ${file.size} bytes`,
      );
      return sendResponse(res, 413, "单个分片大小不能超过10MB");
    }

    logger.info(
      `上传分片 - fileId: ${fileId}, chunk: ${chunkIndex + 1}/${totalChunks}, size: ${file.size}`,
    );

    // 创建文件专属目录
    const fileDir = path.join(CHUNKS_DIR, fileId);
    await fs.mkdir(fileDir, { recursive: true });

    // 保存分片文件
    const chunkPath = path.join(fileDir, `chunk-${chunkIndex}`);
    await fs.writeFile(chunkPath, file.buffer);

    logger.info(`分片保存成功 - ${chunkPath}`);

    // 保存文件元数据
    const metaPath = path.join(fileDir, "meta.json");
    const meta = {
      fileId,
      fileName,
      fileSize,
      totalChunks,
      uploadedChunks: [parseInt(chunkIndex)],
    };

    // 如果元数据已存在，更新已上传的分片列表
    try {
      const existingMeta = JSON.parse(await fs.readFile(metaPath, "utf-8"));
      meta.uploadedChunks = [
        ...new Set([...existingMeta.uploadedChunks, parseInt(chunkIndex)]),
      ].sort((a, b) => a - b);
    } catch (err) {
      // 元数据文件不存在，使用新创建的
    }

    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));

    // 检查是否所有分片都已上传
    const allUploaded = meta.uploadedChunks.length === parseInt(totalChunks);
    sendResponse(res, 200, "分片上传成功", {
      chunkIndex: parseInt(chunkIndex),
      uploadedChunks: meta.uploadedChunks.length,
      totalChunks: parseInt(totalChunks),
      allUploaded,
      fileId,
    });
    // if (allUploaded) {
    //   logger.info(`所有分片上传完成 - fileId: ${fileId}`);
    //   // 自动触发合并（异步执行，不阻塞响应）
    //   mergeChunks(fileId).catch((err) => logger.error(`自动合并失败: ${err}`));
    // }
  } catch (error) {
    logger.error(`分片上传失败: ${error}`);
    sendResponse(res, 500, "分片上传失败", error);
  }
});

/**
 * 合并分片的函数（可被自动调用或手动调用）
 * @param fileId - 文件唯一标识
 * @returns 合并后的文件信息
 */
async function mergeChunks(fileId: string) {
  const fileDir = path.join(CHUNKS_DIR, fileId);
  const metaPath = path.join(fileDir, "meta.json");

  // 读取文件元数据
  const metaContent = await fs.readFile(metaPath, "utf-8");
  const meta = JSON.parse(metaContent);

  logger.info(`开始合并文件 - fileId: ${fileId}, fileName: ${meta.fileName}`);

  // 验证所有分片是否都已上传
  if (meta.uploadedChunks.length !== parseInt(meta.totalChunks)) {
    throw new Error("分片不完整，无法合并");
  }

  // 创建最终文件
  const finalFileName = `${Date.now()}-${meta.fileName}`;
  const finalPath = path.join(UPLOAD_DIR, finalFileName);

  // 按顺序合并分片
  for (let i = 0; i < parseInt(meta.totalChunks); i++) {
    const chunkPath = path.join(fileDir, `chunk-${i}`);
    const chunkData = await fs.readFile(chunkPath);
    await fs.appendFile(finalPath, chunkData);
    await fs.unlink(chunkPath); // 删除已合并的分片
  }

  // 删除元数据文件和空目录
  await fs.unlink(metaPath);
  await fs.rmdir(fileDir);

  // 计算文件MD5用于验证
  const fileBuffer = await fs.readFile(finalPath);
  const md5 = crypto.createHash("md5").update(fileBuffer).digest("hex");

  logger.info(`文件合并成功 - ${finalPath}`);

  return {
    fileName: finalFileName,
    originalName: meta.fileName,
    filePath: `/uploads/files/${finalFileName}`,
    fileSize: meta.fileSize,
    md5,
  };
}

/**
 * 合并所有分片
 * POST /api/file/merge
 * Body: JSON
 * - fileId: 文件唯一标识
 */
router.post("/merge", async (req: any, res) => {
  try {
    const { fileId } = req.body;

    if (!fileId) {
      return sendResponse(res, 400, "缺少fileId参数");
    }

    const result = await mergeChunks(fileId);
    sendResponse(res, 200, "文件合并成功", result);
  } catch (error) {
    logger.error(`文件合并失败: ${error}`);
    sendResponse(res, 500, "文件合并失败", error);
  }
});

/**
 * 检查分片上传状态（断点续传）
 * GET /api/file/check?fileId=xxx
 */
router.get("/check", async (req, res) => {
  try {
    const { fileId } = req.query;

    if (!fileId || typeof fileId !== "string") {
      return sendResponse(res, 400, "缺少fileId参数");
    }

    const metaPath = path.join(CHUNKS_DIR, fileId, "meta.json");

    try {
      const metaContent = await fs.readFile(metaPath, "utf-8");
      const meta = JSON.parse(metaContent);

      logger.info(
        `检查上传状态 - fileId: ${fileId}, 已上传: ${meta.uploadedChunks.length}/${meta.totalChunks}`,
      );

      sendResponse(res, 200, "查询成功", {
        exists: true,
        uploadedChunks: meta.uploadedChunks,
        totalChunks: meta.totalChunks,
        fileName: meta.fileName,
        fileSize: meta.fileSize,
      });
    } catch (err) {
      // 文件不存在
      sendResponse(res, 200, "查询成功", {
        exists: false,
        uploadedChunks: [],
        totalChunks: 0,
      });
    }
  } catch (error) {
    logger.error(`检查上传状态失败: ${error}`);
    sendResponse(res, 500, "检查上传状态失败", error);
  }
});

/**
 * 取消上传并清理临时文件
 * DELETE /api/file/cancel?fileId=xxx
 */
router.delete("/cancel", async (req, res) => {
  try {
    const { fileId } = req.query;

    if (!fileId || typeof fileId !== "string") {
      return sendResponse(res, 400, "缺少fileId参数");
    }

    const fileDir = path.join(CHUNKS_DIR, fileId);

    try {
      // 删除整个目录及其内容
      const files = await fs.readdir(fileDir);
      for (const file of files) {
        await fs.unlink(path.join(fileDir, file));
      }
      await fs.rmdir(fileDir);

      logger.info(`取消上传成功 - fileId: ${fileId}`);
      sendResponse(res, 200, "上传已取消，临时文件已清理");
    } catch (err) {
      // 目录不存在，也视为成功
      sendResponse(res, 200, "上传已取消");
    }
  } catch (error) {
    logger.error(`取消上传失败: ${error}`);
    sendResponse(res, 500, "取消上传失败", error);
  }
});

/**
 * 秒传验证（检查文件是否已存在）
 * GET /api/file/verify?md5=xxx&fileName=xxx&fileSize=xxx
 */
router.get("/verify", async (req, res) => {
  try {
    const { md5, fileName, fileSize } = req.query;

    if (!md5 || !fileName || !fileSize) {
      return sendResponse(res, 400, "缺少必要参数");
    }

    // 在实际应用中，这里应该检查数据库中是否已存在该文件的记录
    // 简化实现：这里只返回不存在，需要上传
    sendResponse(res, 200, "验证成功", {
      exists: false,
      needUpload: true,
    });
  } catch (error) {
    logger.error(`文件验证失败: ${error}`);
    sendResponse(res, 500, "文件验证失败", error);
  }
});
/**
 * 获取文件
 * GET /api/file/list
 * Query: 无
 * 从uploads/files目录读取已上传的文件列表并返回给前端
 */
router.get("/list", async (req, res) => {
  try {
    const files = await fs.readdir(UPLOAD_DIR);
    const fileList = [];
    for (const file of files) {
      const filePath = path.join(UPLOAD_DIR, file);
      const stats = await fs.stat(filePath);
      fileList.push({
        fileName: file,
        id: stats.gid, // 这里使用文件名作为ID，实际应用中可能需要更复杂的ID生成策略
        fileSize: stats.size,
        uploadTime: stats.birthtime,
      });
    }
    sendResponse(res, 200, "查询成功", [...fileList]);
  } catch (error) {
    logger.error(`获取文件列表失败: ${error}`);
    sendResponse(res, 500, "获取文件列表失败", error);
  }
});

/**
 * 删除文件
 * DELETE /api/file/delete?fileId=xxx
 * 从uploads/files目录删除指定文件
 */
router.delete("/delete/:fileId", async (req, res) => {
  try {
    const { fileId } = req.params;

    if (!fileId || typeof fileId !== "string") {
      return sendResponse(res, 400, "缺少fileId参数");
    }

    const filePath = path.join(UPLOAD_DIR, fileId);

    try {
      await fs.unlink(filePath);
      logger.info(`文件删除成功 - fileId: ${fileId}`);
      sendResponse(res, 200, "文件删除成功");
    } catch (err) {
      logger.error(`文件删除失败 - fileId: ${fileId}, 错误: ${err}`);
      sendResponse(res, 500, "文件删除失败", err);
    }
  } catch (error) {
    logger.error(`删除文件失败: ${error}`);
    sendResponse(res, 500, "删除文件失败", error);
  }
});

/**
 * 下载文件
 * GET /api/file/download?fileId=xxx
 * 从uploads/files目录读取指定文件并以blob流的形式返回给前端
 * 注意：实际应用中需要添加权限验证等安全措施
 */

router.get("/download/:fileId", async (req, res) => {
  try {
    const { fileId } = req.params;
    if (!fileId || typeof fileId !== "string") {
      return sendResponse(res, 400, "缺少fileId参数");
    }

    const filePath = path.join(UPLOAD_DIR, fileId);
    // blob流下载文件
    const file = await fs.readFile(filePath);

    // 处理中文文件名编码
    const encodedFileName = encodeURIComponent(fileId);
    res.setHeader("Content-Disposition", `attachment; filename="${encodedFileName}"; filename*=UTF-8''${encodedFileName}`);
    res.setHeader("Content-Type", "application/octet-stream");
    res.send(file);
  } catch (error) {
    logger.error(`下载文件失败: ${error}`);
    sendResponse(res, 500, "下载文件失败", error);
  }
});

export default router;
