# Knowledge base and reply templates

Employees open `/knowledge` from the portal's Help center link. Search matches
article titles, categories, and body text, with 20 results per server-side page.
Only published articles can be listed or fetched, even by guessing an ID.
Unpublishing removes an article from subsequent public requests immediately.
Articles are plain text; HTML/Markdown is not executed or rendered as HTML.
Do not publish passwords, internal-only procedures, or real employee data.

Administrators open **Knowledge & replies** in the IT navigation. They can
create/edit articles, keep them as drafts, and publish/unpublish them. The same
screen manages reusable reply templates and their active/inactive state.
Two generic starter replies are included. The template selector/admin list
currently shows at most 100 templates, ordered by title.

Admin/Agent users select an active template in a ticket conversation and click
**Insert into draft**. This appends to the draft, preserves message visibility,
and never sends automatically. The combined draft remains limited to 5,000
characters. Review and edit it before sending. A public sent reply follows the
existing email/SLA rules; inserting text alone does not change the ticket.
Inactive templates disappear on the next fetch; existing drafts and sent replies
are not rewritten. Viewer accounts cannot fetch or send reply templates.

Migration 010 adds two tables without changing existing tickets. Only
`accounts:manage` can write content, and only `tickets:update` can fetch active
templates. Database backups include both tables. Drafts are not an access-control
mechanism for previously downloaded copies of a once-public article.
