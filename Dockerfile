# 1. 使用 Node.js 镜像
FROM node:18-slim

# 2. 设置工作目录
WORKDIR /app

# 3. 复制 package.json
COPY package*.json ./

# 4. 安装生产环境依赖
RUN npm install --production

# 5. 复制所有代码到容器中
COPY . .

# 6. Cloud Run 默认使用 8080 端口
ENV PORT=8080
EXPOSE 8080

# 7. 启动命令（对应你的项目结构）
CMD ["node", "src/index.js"]
