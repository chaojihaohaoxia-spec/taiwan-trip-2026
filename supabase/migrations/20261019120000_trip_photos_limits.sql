-- =====================================================================
-- 旧的私有桶 trip-photos 补上和 trip-files 一样的大小、类型限制（10-19 代码评审）。
--
-- 网页只往 trip-files 传；trip-photos 是第一版留下来的（10-11 改成私有，现在 0 个文件），
-- 存储策略（trip_files_*_own）两个桶一起管：成员能读、只能写自己的目录——但这个桶没有大小和类型限制，
-- 拿着自己的登录 token 能往里塞任意大小、任意类型的文件。这里补上：20 MB、只收照片和 PDF。
-- 只改 storage.buckets 这一行，不动文件、不动策略；重复执行没有副作用。
-- =====================================================================

UPDATE storage.buckets
SET file_size_limit = 20971520,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'application/pdf']
WHERE id = 'trip-photos';
