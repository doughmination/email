<!-- mailbox/src/web/pages/Terms.svelte
     Copyright (c) 2026 Clove Nytrix Doughmination Twilight
     Licensed under the DASL-1.0 Licence.
     See LICENCE.md in the project root for full licence information. -->
<script lang="ts">
  import LegalPage from "../components/LegalPage.svelte";
  import { router } from "../lib/router.svelte";

  let { standalone = false }: { standalone?: boolean } = $props();

  const contact = "admin@doughmination.gay";
</script>

<LegalPage title="Terms of service" updated="26 October 2026" {standalone}>
  <section>
    <h2>The basics</h2>
    <p>
      This inbox (mail.doughmination.gay) is a small, private email service run by Clove Nytrix Doughmination Twilight.
      By using it you agree to these terms. How your data is handled is covered in the
      <a href={router.href("/privacy")}>privacy policy</a>.
    </p>
  </section>

  <section>
    <h2>What's fine</h2>
    <p>
      It's your inbox. Use it for whatever you like, adult content and porn included, as long as it's legal. Adult
      content is for adults only: don't send it to anyone under 18, or to people who haven't agreed to get it.
    </p>
  </section>

  <section>
    <h2>What isn't</h2>
    <p>Don't use the inbox for anything illegal. That includes, but isn't limited to:</p>
    <ul>
      <li>Any sexual content involving minors. This gets your account removed straight away and reported to the authorities.</li>
      <li>Sharing intimate images of someone without their consent.</li>
      <li>Spam: bulk or unsolicited mail that people didn't ask for.</li>
      <li>Phishing, scams, fraud, or sending malware.</li>
      <li>Threats, harassment, or stalking.</li>
      <li>Trying to break into the service or other people's accounts, or getting in the way of it working for everyone else.</li>
    </ul>
    <p>
      Spam and abuse can also get the shared domains blocked by other mail providers, which hurts everyone using them,
      so it's treated seriously.
    </p>
  </section>

  <section>
    <h2>Moderation</h2>
    <p>
      If something illegal or abusive is reported or spotted, Clove may look at the mail involved, remove it, suspend or
      delete the account, and report it to the authorities where that's needed. Mail isn't read otherwise.
    </p>
  </section>

  <section>
    <h2>Your mail and your account</h2>
    <ul>
      <li>What you write stays yours. The inbox only stores and delivers it so you can use the service.</li>
      <li>You're responsible for what you send, and for keeping your SSO account secure.</li>
      <li>Your addresses come with your account and stop working when it ends.</li>
      <li>You can leave at any time: email <a href="mailto:{contact}">{contact}</a> to have your account deleted.</li>
    </ul>
  </section>

  <section>
    <h2>No guarantees</h2>
    <p>
      The inbox is run by one person and provided as it is. It may go down, lose mail, or change, and there's no promise
      it'll be around forever, so keep your own copies of anything important. As far as the law allows, Clove isn't
      liable for losses from using it or not being able to.
    </p>
  </section>

  <section>
    <h2>Changes</h2>
    <p>
      If these terms change, the date at the top changes with it. Big changes will be announced to account holders.
      Questions go to <a href="mailto:{contact}">{contact}</a>.
    </p>
  </section>
</LegalPage>
