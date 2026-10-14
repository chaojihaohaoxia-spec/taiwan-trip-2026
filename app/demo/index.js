// =====================================================================
// demo/index.js：演示数据模块（被 src/data/demo.js 按需 import，单独成一个分包）。
//
// createDemoDb() 每次返回一份全新的深拷贝：演示模式里随便增删改，都不会影响原始数据，
// 刷新页面就恢复原样。
// =====================================================================

import db from './demo-db.json';
import photo01 from './photos/demo-photo-01.jpg';
import photo02 from './photos/demo-photo-02.jpg';
import photo03 from './photos/demo-photo-03.jpg';
import photo04 from './photos/demo-photo-04.jpg';
import photo05 from './photos/demo-photo-05.jpg';
import photo06 from './photos/demo-photo-06.jpg';
import photo07 from './photos/demo-photo-07.jpg';
import photo08 from './photos/demo-photo-08.jpg';
import confirmationPdf from './files/demo-confirmation.pdf';

/** 演示文件名 → 打包后的网址 */
const ASSETS = {
  'demo-photo-01.jpg': photo01,
  'demo-photo-02.jpg': photo02,
  'demo-photo-03.jpg': photo03,
  'demo-photo-04.jpg': photo04,
  'demo-photo-05.jpg': photo05,
  'demo-photo-06.jpg': photo06,
  'demo-photo-07.jpg': photo07,
  'demo-photo-08.jpg': photo08,
  'demo-confirmation.pdf': confirmationPdf,
};

export function createDemoDb() {
  const tables = structuredClone(db.tables);
  const users = db.users.map((u) => ({ ...u }));
  const photoUrls = {};
  for (const [stored, original] of Object.entries(db.files)) photoUrls[stored] = ASSETS[original] ?? null;
  return {
    users,
    currentUser: users.find((u) => u.id === db.current_user_id),
    tables,
    photoUrls,
  };
}
