@echo off
echo ====================================
echo 开始部署...
echo ====================================

cd C:\wwwroot\my-node-app

echo 1. 停止应用...
pm2 stop my-node-service

echo 2. 删除旧版本...
if exist dist rmdir /s /q dist

echo 3. 安装依赖...
call npm install

echo 4. 构建新版本...
call npm run build

echo 5. 启动应用...
pm2 start ecosystem.config.json --env production

echo 6. 保存配置...
pm2 save

echo 7. 查看状态...
pm2 status

echo ====================================
echo 部署完成！
echo ====================================