DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.ueb_core_data
    LIMIT 1
  ) THEN
    RAISE EXCEPTION
      'Migration requires public.ueb_core_data to be empty';
  END IF;
END
$$;

ALTER TABLE public.ueb_core_data
  ALTER COLUMN khoi_kien_thuc
    TYPE INTEGER
    USING khoi_kien_thuc::INTEGER,
  ALTER COLUMN khoi_kien_thuc
    SET NOT NULL;
