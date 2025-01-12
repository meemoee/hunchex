"use server";
import { getSession } from "@auth0/nextjs-auth0";
import { db } from "./db";
import { users } from "./db/schema";

export async function createOrUpdateUser() {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  
  const { sub, email, name } = session.user;

  try {
    await db
      .insert(users)
      .values({
        id: sub,
        auth0_id: sub,
        email: email || '',  // Provide a default empty string
        name: name || null,
        updated_at: new Date()
      })
      .onConflictDoUpdate({
        target: users.id,
        set: {
          email: email || '',
          name: name || null,
          updated_at: new Date()
        }
      });
  } catch (error) {
    console.error("Error creating/updating user:", error);
    throw error;
  }
}