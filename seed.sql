DELETE FROM memos; -- 先清空旧数据，防止重复

INSERT INTO memos (user_id, content, tags, is_private, created_at) VALUES 
(1, '#JS学习 开启新篇章！🚀\n今天正式开始系统学习 JavaScript。\n即使是 `console.log("Hello World")` 也能让人感到兴奋。\n\n目标：\n- [ ] 搞懂闭包\n- [ ] 学会异步编程', '#Learning #Goal', 0, 1741603200000),
(1, '搞清楚了 `var`, `let`, `const` 的区别。\n**不再使用 var！** 🚫\n\n```javascript\nconst PI = 3.14;\nlet name = "Sunshine";\n```\n类型转换真是个坑。', '#JS #Basic', 0, 1743849600000),
(1, '今天研究了箭头函数 `=>`。\n它不仅写起来简洁，而且 `this` 的指向也更符合直觉。\n\n> Arrow functions allow for a short syntax.\n\n但是要注意，它没有自己的 arguments 对象。', '#ES6 #Function', 0, 1746182400000),
(1, '终于让网页动起来了！✨\n学会了 `document.querySelector` 和 `addEventListener`。\n做了一个简单的点击变色按钮。', '#DOM #Interactive', 0, 1748428800000),
(1, '回调地狱 (Callback Hell) 真的太痛苦了... 💀\n幸好有 **Promise** 和 **Async/Await**。\n代码读起来舒服多了！', '#Async #Promise', 0, 1750848000000),
(1, '项目文件越来越多了，开始学习 Module。\n`import` 和 `export` 让代码组织变得井井有条。', '#Architecture #Modules', 0, 1753008000000),
(1, '开始接触框架了，选择了 React。⚛️\nJSX 的写法一开始有点不习惯，但组件化思想真的很棒！', '#React #Framework', 0, 1755254400000),
(1, '组件传值透传 (Props Drilling) 太麻烦了。\n研究了一下 Context API 和 Redux。感觉对于小项目，Context 就足够了。', '#StateManagement', 0, 1757673600000),
(1, '只做前端感觉受限，开始看 Node.js。\n用 Express 写了一个简单的 API 接口。\nJavaScript 统治世界！🌍', '#NodeJS #Backend', 0, 1760092800000),
(1, '网站加载有点慢，开始学习性能优化。\n优化完之后 Lighthouse 分数从 60 涨到了 95，成就感满满！💪', '#Performance', 0, 1762339200000),
(1, '#Summary 2025年终总结。\n从不懂变量是什么，到现在能独立开发全栈小应用。\n明年继续加油！✨', '#Review #2025', 0, 1764672000000),
(1, '#2026 #ThreeJS\n新的一年，开始啃 3D 图形学。\nThree.js 的文档看起来很丰富，先画一个旋转的立方体吧！🎲', '#3D #Graphics', 0, 1768473600000);