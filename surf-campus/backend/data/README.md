# SURF Campus data storage

当前本地演示使用 `backend/data/*.json` 作为轻量持久化层，`SURF_DATA_DIR` 可以把它切换到独立目录：

- `auth.json`：登录会话和私密账号凭据。密码只保存带随机盐的 PBKDF2-SHA256 哈希；手机号保存在账号记录中，前端只展示掩码。
- `users.json`：可展示的用户资料（姓名、学院、年级、兴趣标签、邮箱和手机号掩码），不保存密码。
- `posts.json`、`comments` 字段：帖子及评论；`likes.json`：按用户记录点赞关系。
- `opportunities.json`：组队招募和申请；`groups.json`：项目群成员与消息。

生产环境应将 `auth.json` 迁移到受访问控制的关系型数据库或托管身份服务，开启磁盘加密、备份、审计和密钥管理；不要把真实密码、短信验证码或未脱敏手机号提交到版本库。
