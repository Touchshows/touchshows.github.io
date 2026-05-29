# TouchShows Blog

这是一个静态个人资料展示站。材料文件会在发布前用访问密码加密，页面加载后由浏览器本地解密展示。

## 重新生成加密内容

```powershell
$env:BLOG_PASSWORD="你的访问密码"
node tools/build-content.mjs
```

发布到 GitHub Pages 时，不要提交原始资料文件夹，只提交 `content/` 里生成的加密文件和站点代码。
