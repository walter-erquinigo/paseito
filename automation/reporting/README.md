# Daily NVIDIA SMTP report bootstrap

The daily report runs locally and sends from `werquinigo@nvidia.com` to
`werquinigo@nvidia.com` through NVIDIA's authenticated relay at `mail.nvidia.com:587` with
STARTTLS. NVIDIA requires the Mac to be on-premises or connected to VPN for authenticated relay
access.

Store the SMTP password in the macOS login Keychain. Run this directly in an interactive Terminal;
do not paste the password into Codex, a shell argument, a repository file, or an environment
variable:

```sh
python3 automation/reporting/configure_nvidia_smtp.py
```

Then install both local agents and send a one-time verification message:

```sh
python3 automation/launchagents/install_launchagents.py
python3 automation/reporting/local_smtp_report.py --force
```

The reporting agent runs hourly. The first run at or after 08:00 America/New_York sends the report;
a private date key suppresses duplicates. A sleeping Mac catches up after waking. Delivery failures
are retried hourly and recorded in a persistent GitHub issue without SMTP details or credentials.

NVIDIA's relay documentation recommends a service account for unattended automation because a
personal password can change or lock out. This personal-account setup follows the requested sender,
but migrating it to a scoped service account remains the safer long-term configuration.
