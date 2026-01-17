// GET /api/contacts
router.get("/contacts", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    // Fetch contacts
    const { rows } = await db.query(`
      SELECT 
        u.user_id        AS contact_id,
        u.fullname       AS contact_name,
        u.email          AS contact_email,
        u.avatar         AS avatar_filename,
        u.phone          AS contact_phone,
        u.bio            AS contact_bio,
        u.banner         AS contact_banner,
        c.blocked        AS blocked,
        c.is_favorite    AS is_favorite,
        c.created_at     AS added_on
      FROM contacts c
      JOIN users u ON c.contact_id = u.user_id
      WHERE c.user_id = $1
      ORDER BY u.fullname ASC
    `, [userId]);

    const contacts = [];
    const blocked = [];

    // Prepare last message lookup
    const msgQuery = `
      SELECT 
        m.message,
        m.created_at,
        (
          SELECT COUNT(*) FROM messages 
          WHERE receiver_id = $1 AND sender_id = $2 AND seen = 0
        ) AS unread_count
      FROM messages m
      WHERE 
        (m.sender_id = $2 AND m.receiver_id = $1)
        OR
        (m.sender_id = $1 AND m.receiver_id = $2)
      ORDER BY m.created_at DESC
      LIMIT 1
    `;

    for (const row of rows) {
      const contactId = row.contact_id;

      const msg = await db.query(msgQuery, [userId, contactId]);
      const last = msg.rows[0] || {};

      const contact = {
        contact_id: contactId,
        contact_name: row.contact_name,
        contact_email: row.contact_email,
        contact_avatar: row.avatar_filename
          ? `/uploads/avatars/${row.avatar_filename}`
          : `/img/defaultUser.png`,
        contact_phone: row.contact_phone,
        contact_bio: row.contact_bio,
        contact_banner: row.contact_banner
          ? `/uploads/banners/${row.contact_banner}`
          : `/img/profile-banner.jpg`,
        is_favorite: row.is_favorite,
        added_on: row.added_on,
        online: false, // updated by WebSocket

        last_message: last.message || null,
        last_message_at: last.created_at || null,
        unread_count: Number(last.unread_count || 0)
      };

      if (row.blocked) blocked.push(contact);
      else contacts.push(contact);
    }

    res.json({ contacts, blocked, error: null });

  } catch (err) {
    res.json({ contacts: [], blocked: [], error: err.message });
  }
});
