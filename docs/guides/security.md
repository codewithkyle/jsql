# Security

## Sensitive & Private Data

Data stored in IndexedDB restricts access to the origin domain preventing other sites from accessing the data, however, that doesn't mean it's secure. Don't store sensitive data like credit card numbers in the local database.

## SQL Injection Attacks

Queries are performed on the local dataset so if the end user wants to SQL inject themselves they can, it's their computer and their browser. Who are we to try and stop them. However, you should never ever ever **EVER** send SQL queries directly to your database server. Build a proper API with authentication.

## Malicious Code Injections

Most modern browsers run the sites JavaScript in a sandbox environment so you don't typically need to worry about this too much. However, it's your job to make sure you're not introducing sketchy libraries and 3rd party code into your application. We also recommend that you download the Web Worker scripts and host the files yourself instead of trusting the CDN hasn't been compromised.