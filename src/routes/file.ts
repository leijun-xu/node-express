import express from "express";
import { logger } from "../utils/logger.js";
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

// 合并锁,防止同一文件并发合并
const mergeLocks = new Map<string, Promise<any>>();

// 根据环境变量或构建目录确定上传路径
const basePath = process.cwd(); // 项目根目录

// 临时分片存储目录
const CHUNKS_DIR = path.join(basePath, "uploads", "chunks");
// 最终文件存储目录
const UPLOAD_DIR = path.join(basePath, "uploads", "files");

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
    logger.info(`收到上传请求 - Content-Type: ${req.get("Content-Type")}`);
    logger.info(`req.body: ${JSON.stringify(req.body)}`);
    logger.info(
      `req.file: ${
        !!req.file
          ? JSON.stringify({
              originalname: req.file.originalname,
              size: req.file.size,
              mimetype: req.file.mimetype,
            })
          : "null"
      }`,
    );

    const { chunkIndex, totalChunks, fileId, fileName, fileSize } =
      req.body || {};
    const file = req.file;

    logger.info(
      `解析参数 - chunkIndex: ${chunkIndex}, totalChunks: ${totalChunks}, fileId: ${fileId}, fileName: ${fileName}, fileSize: ${fileSize}`,
    );

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
        bodyKeys: Object.keys(req.body || {}),
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
      `上传分片 - fileId: ${fileId}, chunk: ${parseInt(chunkIndex) + 1}/${parseInt(totalChunks)}, size: ${file.size}`,
    );

    // 验证文件缓冲区是否存在
    if (!file.buffer || file.buffer.length === 0) {
      logger.error(
        `文件缓冲区为空 - fileId: ${fileId}, chunkIndex: ${chunkIndex}`,
      );
      throw new Error("文件缓冲区为空，可能是multer配置问题");
    }

    // 创建文件专属目录
    const fileDir = path.join(CHUNKS_DIR, fileId);
    logger.info(`创建目录: ${fileDir}`);
    await fs.mkdir(fileDir, { recursive: true });

    // 保存分片文件
    const chunkPath = path.join(fileDir, `chunk-${chunkIndex}`);
    logger.info(`保存分片: ${chunkPath}, 大小: ${file.buffer.length} bytes`);

    await fs.writeFile(chunkPath, file.buffer);
    logger.info(`分片保存成功: ${chunkPath}`);

    logger.info(`分片保存成功 - ${chunkPath}`);

    // 保存文件元数据（使用重试机制和原子写入防止并发问题）
    const metaPath = path.join(fileDir, "meta.json");
    const parsedChunkIndex = parseInt(chunkIndex);

    let retryCount = 0;
    const maxRetries = 3;
    let meta = {
      fileId,
      fileName,
      fileSize,
      totalChunks,
      uploadedChunks: [parsedChunkIndex],
    };

    // 原子写入函数：使用临时文件+重命名
    async function atomicWrite(filePath: string, content: string) {
      const tempPath = `${filePath}.tmp`;
      await fs.writeFile(tempPath, content);
      await fs.rename(tempPath, filePath);
    }

    // 如果元数据已存在，更新已上传的分片列表
    while (retryCount < maxRetries) {
      try {
        // 先检查元数据文件是否存在
        try {
          await fs.access(metaPath);
          // 文件存在，读取并更新
          const existingMetaContent = await fs.readFile(metaPath, "utf-8");
          const existingMeta = JSON.parse(existingMetaContent);

          logger.info(
            `读取现有元数据成功 - fileId: ${fileId}, 已上传分片: ${existingMeta.uploadedChunks.join(", ")}`,
          );

          // 合并已上传的分片列表
          const allChunks = new Set([
            ...existingMeta.uploadedChunks,
            parsedChunkIndex,
          ]);
          meta.uploadedChunks = Array.from(allChunks).sort((a, b) => a - b);

          logger.info(
            `更新元数据 - fileId: ${fileId}, 新分片: ${parsedChunkIndex}, 总分片数: ${meta.uploadedChunks.length}`,
          );

          // 使用原子写入更新元数据
          await atomicWrite(metaPath, JSON.stringify(meta, null, 2));

          logger.info(
            `元数据更新成功 - fileId: ${fileId}, uploadedChunks: ${meta.uploadedChunks.join(", ")}`,
          );
        } catch (accessErr) {
          // 文件不存在，这是第一次上传，直接写入新的元数据
          const error = accessErr as any;
          if (error.code === "ENOENT") {
            logger.info(`元数据文件不存在，创建新文件 - fileId: ${fileId}`);
            await atomicWrite(metaPath, JSON.stringify(meta, null, 2));
            logger.info(
              `元数据创建成功 - fileId: ${fileId}, uploadedChunks: ${meta.uploadedChunks.join(", ")}`,
            );
          } else {
            throw accessErr;
          }
        }

        break; // 成功，退出重试循环
      } catch (err) {
        retryCount++;
        logger.warn(
          `元数据文件操作失败，重试 ${retryCount}/${maxRetries} - fileId: ${fileId}, error: ${err}`,
        );

        if (retryCount >= maxRetries) {
          logger.error(
            `元数据文件操作失败，达到最大重试次数 - fileId: ${fileId}, error: ${err}`,
          );
          throw new Error(`更新元数据失败: ${err}`);
        }

        // 短暂延迟后重试
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    // 检查是否所有分片都已上传
    const allUploaded = meta.uploadedChunks.length === parseInt(totalChunks);
    sendResponse(res, 200, "分片上传成功", {
      chunkIndex: parseInt(chunkIndex),
      uploadedChunks: meta.uploadedChunks.length,
      totalChunks: parseInt(totalChunks),
      allUploaded,
      fileId,
    });

    // 当所有分片上传完成时，自动触发合并（异步执行，不阻塞响应）
    if (allUploaded) {
      logger.info(`所有分片上传完成 - fileId: ${fileId}，开始自动合并`);
      // 异步合并，不阻塞当前响应
      mergeChunksWithLock(fileId)
        .then((result) => {
          logger.info(
            `自动合并成功 - fileId: ${fileId}, fileName: ${result.fileName}`,
          );
        })
        .catch((err) => {
          logger.error(`自动合并失败 - fileId: ${fileId}, 错误: ${err}`);
        });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : "No stack trace";

    logger.error(
      `分片上传失败 - fileId: ${req.body?.fileId}, chunkIndex: ${req.body?.chunkIndex}, 错误: ${errorMessage}`,
    );
    logger.error(`错误堆栈: ${errorStack}`);

    sendResponse(res, 500, "分片上传失败", {
      error: errorMessage,
      fileId: req.body?.fileId,
      chunkIndex: req.body?.chunkIndex,
    });
  }
});

/**
 * 带锁的合并函数，防止并发合并
 * @param fileId - 文件唯一标识
 * @returns 合并后的文件信息
 */
async function mergeChunksWithLock(fileId: string) {
  // 检查是否已有正在进行的合并
  if (mergeLocks.has(fileId)) {
    logger.info(`文件 ${fileId} 正在合并中，跳过本次合并请求`);
    return mergeLocks.get(fileId);
  }

  // 创建合并任务
  const mergePromise = mergeChunks(fileId).finally(() => {
    // 无论成功或失败，都要释放锁
    mergeLocks.delete(fileId);
    logger.info(`合并锁已释放 - fileId: ${fileId}`);
  });

  // 将合并任务加入锁
  mergeLocks.set(fileId, mergePromise);

  return mergePromise;
}

/**
 * 合并分片的函数（可被自动调用或手动调用）
 * @param fileId - 文件唯一标识
 * @returns 合并后的文件信息
 */
async function mergeChunks(fileId: string) {
  const fileDir = path.join(CHUNKS_DIR, fileId);
  const metaPath = path.join(fileDir, "meta.json");
  let finalPath = "";

  try {
    // 读取文件元数据
    const metaContent = await fs.readFile(metaPath, "utf-8");
    const meta = JSON.parse(metaContent);

    logger.info(
      `开始合并文件 - fileId: ${fileId}, fileName: ${meta.fileName}, 已上传: ${meta.uploadedChunks.length}/${meta.totalChunks}`,
    );

    // 验证所有分片是否都已上传
    const totalChunks = parseInt(meta.totalChunks);
    if (meta.uploadedChunks.length !== totalChunks) {
      throw new Error(
        `分片不完整，无法合并。已上传: ${meta.uploadedChunks.length}/${totalChunks}`,
      );
    }

    // 验证分片索引的完整性（0 到 totalChunks-1 都必须存在）
    const missingChunks = [];
    for (let i = 0; i < totalChunks; i++) {
      if (!meta.uploadedChunks.includes(i)) {
        missingChunks.push(i);
      }
    }

    if (missingChunks.length > 0) {
      throw new Error(`缺少分片: ${missingChunks.join(", ")}`);
    }

    // 创建最终文件
    const finalFileName = `${Date.now()}-${meta.fileName}`;
    finalPath = path.join(UPLOAD_DIR, finalFileName);

    logger.info(`开始合并 ${totalChunks} 个分片到 ${finalPath}`);

    // 按顺序合并分片
    for (let i = 0; i < totalChunks; i++) {
      const chunkPath = path.join(fileDir, `chunk-${i}`);

      // 检查分片文件是否存在
      try {
        await fs.access(chunkPath);
      } catch (err) {
        throw new Error(`分片文件不存在: chunk-${i}`);
      }

      const chunkData = await fs.readFile(chunkPath);
      await fs.appendFile(finalPath, chunkData);
      await fs.unlink(chunkPath); // 删除已合并的分片

      if ((i + 1) % 10 === 0) {
        logger.info(`已合并 ${i + 1}/${totalChunks} 个分片`);
      }
    }

    // 删除元数据文件和空目录
    await fs.unlink(metaPath);
    await fs.rmdir(fileDir);

    logger.info(`临时分片文件已清理 - fileId: ${fileId}`);

    // 计算文件MD5用于验证
    const fileBuffer = await fs.readFile(finalPath);
    const md5 = crypto.createHash("md5").update(fileBuffer).digest("hex");

    logger.info(
      `文件合并成功 - ${finalPath}, 大小: ${fileBuffer.length} bytes`,
    );

    return {
      fileName: finalFileName,
      originalName: meta.fileName,
      filePath: `/uploads/files/${finalFileName}`,
      fileSize: meta.fileSize,
      md5,
      actualSize: fileBuffer.length.toString(),
    };
  } catch (error) {
    // 合并失败时,清理临时文件
    logger.error(
      `合并失败,开始清理临时文件 - fileId: ${fileId}, 错误: ${error}`,
    );

    try {
      // 删除可能已创建的部分合并文件
      if (finalPath) {
        await fs.unlink(finalPath).catch(() => {
          // 文件可能不存在,忽略错误
        });
      }

      // 删除所有剩余的分片文件和元数据
      const files = await fs.readdir(fileDir).catch(() => []);
      for (const file of files) {
        await fs.unlink(path.join(fileDir, file)).catch(() => {});
      }
      await fs.rmdir(fileDir).catch(() => {});

      logger.info(`临时文件清理完成 - fileId: ${fileId}`);
    } catch (cleanupError) {
      logger.error(
        `清理临时文件失败 - fileId: ${fileId}, 错误: ${cleanupError}`,
      );
    }

    throw error;
  }
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

    logger.info(`收到合并请求 - fileId: ${fileId}`);

    const result = await mergeChunksWithLock(fileId);
    sendResponse(res, 200, "文件合并成功", result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(
      `文件合并失败 - fileId: ${req.body?.fileId}, 错误: ${errorMessage}`,
    );
    sendResponse(res, 500, "文件合并失败", { error: errorMessage });
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
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodedFileName}"; filename*=UTF-8''${encodedFileName}`,
    );
    res.setHeader("Content-Type", "application/octet-stream");
    res.send(file);
  } catch (error) {
    logger.error(`下载文件失败: ${error}`);
    sendResponse(res, 500, "下载文件失败", error);
  }
});

export default router;
