import "dotenv/config";
import postgres from "postgres";
async function main() {
  const sql = postgres(process.env.SUPABASE_DB_URL!, { max: 1 });
  const accounts = await sql`select id, client_name, archived, kantata_project_ids from collab.client_account where client_name ilike '%PATNC%'`;
  console.log("client_account rows matching PATNC:", accounts);
  if (accounts.length > 0) {
    const accountId = accounts[0].id;
    const roles = await sql`select ur.user_id, ur.role, au.email from collab.user_role ur join auth.users au on au.id = ur.user_id where ur.account_id = ${accountId}`;
    console.log("user_role rows for this account:", roles);
    const members = await sql`select am.id, am.user_id, am.name, au.email as auth_email from collab.account_member am left join auth.users au on au.id = am.user_id where am.account_id = ${accountId} and am.user_id is not null`;
    console.log("account_member rows with a user_id for this account:", members);
  }
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
