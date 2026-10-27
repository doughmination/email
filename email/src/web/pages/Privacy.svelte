<!-- mailbox/src/web/pages/Privacy.svelte
     Copyright (c) 2026 Clove Nytrix Doughmination Twilight
     Licensed under the DASL-1.0 Licence.
     See LICENCE.md in the project root for full licence information. -->
<script lang="ts">
  import LegalPage from "../components/LegalPage.svelte";
  import { router } from "../lib/router.svelte";

  let { standalone = false }: { standalone?: boolean } = $props();

  const contact = "admin@doughmination.gay";
</script>

<LegalPage title="Privacy policy" updated="26 October 2026" {standalone}>
  <section>
    <h2>Who we are</h2>
    <p>
      This inbox (mail.doughmination.gay) is a small, private email service run by Clove Nytrix Doughmination Twilight.
      Accounts are only for people let in through the Doughmination SSO. Questions or requests about your data go to
      <a href="mailto:{contact}">{contact}</a>. Using the inbox also means agreeing to the
      <a href={router.href("/terms")}>terms of service</a>.
    </p>
  </section>

  <section>
    <h2>What the inbox stores</h2>
    <ul>
      <li><strong>Your account:</strong> your username, your SSO account ID, the name you send as, whether you're an admin, and when you joined and last signed in.</li>
      <li><strong>Your mail:</strong> every message you receive, send or save as a draft, including who it's from and to (and Bcc on mail you send), the subject, the body and any attachments.</li>
      <li><strong>Sign-in sessions:</strong> a random session token, plus the refresh token the SSO gives us so we can check your account is still active.</li>
      <li><strong>Notifications:</strong> if you turn them on, the push address and keys your browser gives us for that device.</li>
    </ul>
    <p>Mail is stored so you can read it here. It isn't end-to-end encrypted, the same as most email.</p>
  </section>

  <section>
    <h2>Who can see your mail</h2>
    <p>
      Clove, who runs the inbox, has access to the mail that passes through it, through the Resend dashboard (and the
      inbox's own database). Your mail isn't read unless it's absolutely needed for moderation, for example to look into
      a report of illegal content or abuse under the <a href={router.href("/terms")}>terms</a>.
    </p>
  </section>

  <section>
    <h2>Signing in (Doughmination SSO)</h2>
    <p>You sign in through auth.doughmination.gay, which is run by the same person and keeps:</p>
    <ul>
      <li>Your username, name, email address and whether it's verified.</li>
      <li>Your password (only as a one-way hash), passkeys (public keys only), and your two-factor secret (encrypted).</li>
      <li>Your active sessions, each with the IP address and browser it was started from, so you can see and end them.</li>
      <li>The browsers you've signed in from (as a hashed cookie), so signing in somewhere new can email you a security notice. That notice includes the IP address and rough location (city and country) of the sign-in.</li>
      <li>A log of security events, such as sign-ins and account changes, with the IP address involved.</li>
    </ul>
  </section>

  <section>
    <h2>Who else handles it</h2>
    <ul>
      <li><strong>Cloudflare</strong> hosts the inbox and the SSO, including the databases and attachment storage. Like any web host it sees requests, including your IP address, and keeps short-lived logs of them.</li>
      <li><strong>Resend</strong> delivers all mail in and out, so it handles every message you send and receive on its way through and keeps a copy for a while. The SSO's account emails are sent through it too.</li>
      <li><strong>Your browser's push service</strong> (Google, Apple or Mozilla, depending on your browser) carries notifications. They're encrypted, so the push service can't read them.</li>
      <li><strong>The people you email with</strong> get what you send them, like with any email.</li>
      <li><strong>Remote images:</strong> pictures hosted elsewhere in an email are blocked until you choose to show them. Once you do, the sender's servers can see your IP address and that you opened it.</li>
    </ul>
    <p>Nothing is sold or shared for advertising, and there are no analytics or trackers.</p>
  </section>

  <section>
    <h2>Cookies</h2>
    <ul>
      <li><code>session</code> keeps you signed in to the inbox, for up to 30 days.</li>
      <li><code>login</code> lasts 10 minutes while you're signing in.</li>
      <li>The SSO sets its own sign-in cookie, and a device cookie that it remembers for up to a year.</li>
    </ul>
    <p>They're only used to sign you in and keep you secure.</p>
  </section>

  <section>
    <h2>How long it's kept</h2>
    <ul>
      <li>Mail stays until you delete it. Deleted mail goes to the Bin and is gone for good after 30 days, or straight away if you empty the Bin.</li>
      <li>Attachments you upload but never send are removed after 2 days.</li>
      <li>Inbox sessions end after 30 days at most.</li>
      <li>The SSO's security log is kept for 180 days, and a browser it hasn't seen for a year is forgotten.</li>
      <li>Deleting your account removes your mail, attachments, addresses and notification settings.</li>
    </ul>
  </section>

  <section>
    <h2>Your choices</h2>
    <p>
      You can change the name you send as and turn notifications off in Settings, and delete any of your mail at any
      time. To get a copy of your data, have something corrected, or have your account deleted, email
      <a href="mailto:{contact}">{contact}</a>. You can also complain to your local data protection authority.
    </p>
  </section>

  <section>
    <h2>Changes</h2>
    <p>If this policy changes, the date at the top changes with it. Big changes will be announced to account holders.</p>
  </section>
</LegalPage>
