# 字鉴 · 文档对比工作台

> **两稿并排，字字可选，让每一次修改都有据可依。**

字鉴是一款纯浏览器运行的富文档对比与合并工具。将两份相似文档拖入左右工作区，即可在接近 Word 的分页视图中逐词高亮差异、直接修改任意一侧，并逐处决定最终稿采用哪个版本。

**在线体验：** [ziyiw9823-henry.github.io/zijian-document-compare](https://ziyiw9823-henry.github.io/zijian-document-compare/)

## 功能亮点

- 文件直接拖放，无需先上传到服务器
- DOCX 按页渲染，保留标题、段落、表格、图片、页眉页脚等常用格式
- 支持文字型 PDF、TXT、Markdown、HTML 和 CSV
- 中英文逐词比较，差异直接标记在左右文档正文中
- 左右文档均保持可编辑，并提供基础富文本工具栏
- 每处差异可选择采用 A、采用 B、全部保留或全部删除
- 独立“满意稿”实时合并，可继续润色并导出 TXT
- 所有解析和比较均在浏览器本地完成

## 快速开始

项目不需要构建工具或后端服务。克隆仓库后，在项目目录启动任意静态文件服务器：

```bash
python -m http.server 8000
```

然后访问 `http://localhost:8000`。

也可以将仓库直接部署到 GitHub Pages、Cloudflare Pages、Netlify 或其他静态托管平台。

## 使用方法

1. 将原始稿拖入版本 A 区域。
2. 将修订稿拖入版本 B 区域。
3. 点击“开始逐词对比”，差异会直接高亮在两份文档中。
4. 在任一文档内直接修改内容；修改后重新计算差异。
5. 在下方逐处选择需要保留的版本，并继续编辑满意稿。

## 支持范围

| 格式 | 展示方式 | 可编辑 |
| --- | --- | --- |
| DOCX | 分页富文档视图 | 是 |
| PDF | 按页提取文字 | 文字型 PDF 可编辑 |
| TXT / MD / CSV | 页面式文本视图 | 是 |
| HTML | 清理危险标签后的富文本视图 | 是 |

扫描版 PDF 需要先进行 OCR。复杂 Word 域、宏、特殊浮动对象或桌面字体可能无法与 Microsoft Word / WPS 完全一致。

## 隐私

拖入的文件不会发送到应用服务器。文件解析、差异计算、编辑和导出均在当前浏览器中完成。本地自动保存使用浏览器的 `localStorage`。

## 技术结构

- 原生 HTML、CSS、JavaScript
- Myers 差异算法
- `Intl.Segmenter` 中英文分词
- docx-preview + JSZip 渲染 DOCX
- Mammoth 作为 DOCX HTML 回退方案
- PDF.js 提取文字型 PDF

## 开源许可

项目自身代码采用 [MIT License](LICENSE)。第三方组件继续遵循各自许可，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

