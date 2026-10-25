CREATE OR REPLACE FUNCTION public.uuid_v7() RETURNS uuid AS $$
DECLARE
  timestamp_ms bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  uuid_bytes bytea;
BEGIN
  uuid_bytes := substring(int8send(timestamp_ms) from 3 for 6) || gen_random_bytes(10);
  uuid_bytes := set_byte(uuid_bytes, 6, (get_byte(uuid_bytes, 6) & 15) | 112);
  uuid_bytes := set_byte(uuid_bytes, 8, (get_byte(uuid_bytes, 8) & 63) | 128);
  RETURN encode(uuid_bytes, 'hex')::uuid;
END;
$$ LANGUAGE plpgsql;

ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'seeker';
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'employer';
