-- 010_username_tanpa_besar_kecil.sql — username tidak lagi peka huruf besar/kecil.
--
-- Kenapa: keyboard HP otomatis mengapitalkan huruf pertama, sehingga "Superadmin" dikirim
-- padahal akunnya "superadmin". Login lama memakai perbandingan persis, jadi password yang
-- BENAR tetap ditolak dan pesannya "Username atau password salah" — membingungkan.
--
-- Setelah ini, pencarian login memakai lower(username) dan keunikan ditegakkan pada bentuk
-- yang sama, supaya "aldi" dan "Aldi" tidak bisa menjadi dua akun berbeda yang membingungkan.

-- Hentikan dengan pesan jelas bila data lama sudah punya username yang bentrok.
DO $$
DECLARE
  bentrok text;
BEGIN
  SELECT string_agg(lower(username), ', ') INTO bentrok
    FROM users GROUP BY lower(username) HAVING count(*) > 1;
  IF bentrok IS NOT NULL THEN
    RAISE EXCEPTION 'Username bentrok tanpa membedakan besar/kecil: %. Ganti salah satunya dulu.', bentrok;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (lower(username));
