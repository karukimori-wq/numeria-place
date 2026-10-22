// Exact-pinned, disposable PostgreSQL guard; never run as a production migration.
const trigger="np_poc_freeze_cart";
export async function installCartSeal(pg:any) {
  if(process.env.NODE_ENV!=="test")throw Error("NP_TEST_ONLY_DDL");
  await pg.raw(`CREATE TABLE IF NOT EXISTS np_poc_cart_seals(cart_id text PRIMARY KEY,snapshot jsonb NOT NULL,snapshot_hash text NOT NULL);
    CREATE OR REPLACE FUNCTION np_poc_guard_seal() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE oldj jsonb; newj jsonb; k text; cid text; ids text[]:=ARRAY[]::text[];
    BEGIN
      IF TG_OP<>'INSERT' THEN oldj=to_jsonb(OLD); END IF;
      IF TG_OP<>'DELETE' THEN newj=to_jsonb(NEW); END IF;
      IF TG_ARGV[0]='collection' AND TG_OP='UPDATE' AND
         oldj->'amount' IS NOT DISTINCT FROM newj->'amount' AND
         oldj->'currency_code' IS NOT DISTINCT FROM newj->'currency_code' AND
         oldj->'raw_amount' IS NOT DISTINCT FROM newj->'raw_amount' AND
         oldj->'deleted_at' IS NOT DISTINCT FROM newj->'deleted_at' THEN RETURN NEW; END IF;
      FOR k IN SELECT DISTINCT v FROM (VALUES(oldj->>TG_ARGV[1]),(newj->>TG_ARGV[1])) x(v) WHERE v IS NOT NULL LOOP
        IF TG_ARGV[0]='root' OR TG_ARGV[0]='cart' THEN ids=array_append(ids,k);
        ELSIF TG_ARGV[0]='line' THEN
          SELECT cart_id INTO cid FROM cart_line_item WHERE id=k; ids=array_append(ids,cid);
        ELSIF TG_ARGV[0]='ship' THEN
          SELECT cart_id INTO cid FROM cart_shipping_method WHERE id=k; ids=array_append(ids,cid);
        ELSIF TG_ARGV[0]='collection' THEN
          SELECT cart_id INTO cid FROM np_poc_cart_seals WHERE snapshot->>'collectionId'=k; ids=array_append(ids,cid);
        END IF;
      END LOOP;
      FOR cid IN SELECT DISTINCT v FROM unnest(ids) x(v) WHERE v IS NOT NULL ORDER BY v LOOP
        PERFORM id FROM cart WHERE id=cid FOR UPDATE;
        IF EXISTS(SELECT 1 FROM np_poc_cart_seals WHERE cart_id=cid) THEN
          RAISE EXCEPTION 'NP_SEALED_CART_IMMUTABLE';
        END IF;
      END LOOP;
      IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
    END $$;`);
  const rows=(await pg.raw(`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,column_name`)).rows;
  const columns=new Map<string,Set<string>>();
  for(const row of rows){if(!columns.has(row.table_name))columns.set(row.table_name,new Set());columns.get(row.table_name)!.add(row.column_name);}
  for(const [table,c] of columns){
    let kind="", key="";
    if(table==="cart"){kind="root";key="id";}
    else if(table==="payment_collection"){kind="collection";key="id";}
    else if(c.has("cart_id") && table!=="np_poc_cart_seals"){kind="cart";key="cart_id";}
    else if(c.has("cart_line_item_id")){kind="line";key="cart_line_item_id";}
    else if(c.has("line_item_id") && c.has("offer_id")){kind="line";key="line_item_id";}
    else if(c.has("item_id") && table.startsWith("cart_line_item_")){kind="line";key="item_id";}
    else if(c.has("shipping_method_id") && table.startsWith("cart_shipping_method_")){kind="ship";key="shipping_method_id";}
    if(!kind)continue;
    if(!/^[a-z0-9_]+$/.test(table))throw Error("NP_UNEXPECTED_TABLE_NAME");
    await pg.raw(`DROP TRIGGER IF EXISTS ${trigger} ON "${table}";
      CREATE TRIGGER ${trigger} BEFORE INSERT OR UPDATE OR DELETE ON "${table}" FOR EACH ROW EXECUTE FUNCTION np_poc_guard_seal('${kind}','${key}');`);
  }
}
export async function removeCartSeal(pg:any) {
  const rows=(await pg.raw(`SELECT c.relname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE t.tgname='np_poc_freeze_cart' AND NOT t.tgisinternal`)).rows;
  for(const {relname} of rows){if(!/^[a-z0-9_]+$/.test(relname))throw Error("NP_BAD_TABLE");await pg.raw(`DROP TRIGGER IF EXISTS ${trigger} ON "${relname}"`);}
  await pg.raw("DROP FUNCTION IF EXISTS np_poc_guard_seal(); DROP TABLE IF EXISTS np_poc_cart_seals");
}
