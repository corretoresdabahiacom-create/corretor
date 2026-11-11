-- Vídeos enviados como arquivo (MP4/WebM) ficam na mesma tabela de arquivos do imóvel.
ALTER TABLE files DROP CONSTRAINT IF EXISTS files_category_check;
ALTER TABLE files ADD CONSTRAINT files_category_check CHECK (category IN ('foto','documento','video'));
