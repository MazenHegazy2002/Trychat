// "Claude (my API)" for Windows: opens the Claude desktop app in its third-party inference mode, connected to your
// own API gateway (the documented registry policy under HKCU\SOFTWARE\Policies\Claude). --code opens Claude Code
// instead. The server address is built in; the key is asked for on first run and kept encrypted for this Windows user
// (DPAPI), never in this file. Run with --reset to enter a new key or address.
using System;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32;

class ClaudeLauncher
{
    const string DefaultUrl = "https://brandyy.shop:20128";
    static readonly string Dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "ClaudeMyApi");
    static readonly string UrlFile = Path.Combine(Dir, "url.txt");
    static readonly string KeyFile = Path.Combine(Dir, "key.bin");

    static int Main(string[] args)
    {
        Console.Title = "Claude (my API)";
        Directory.CreateDirectory(Dir);
        bool reset = Array.IndexOf(args, "--reset") >= 0;

        string url = !reset && File.Exists(UrlFile) ? File.ReadAllText(UrlFile).Trim() : null;
        if (string.IsNullOrEmpty(url))
        {
            Console.Write("API address [" + DefaultUrl + "]: ");
            url = Console.ReadLine();
            url = string.IsNullOrWhiteSpace(url) ? DefaultUrl : url.Trim();
            // Claude Code adds /v1/messages itself, so drop a trailing /v1.
            url = url.TrimEnd('/');
            if (url.EndsWith("/v1")) url = url.Substring(0, url.Length - 3);
            File.WriteAllText(UrlFile, url);
        }

        string key = null;
        if (!reset && File.Exists(KeyFile))
        {
            try { key = Encoding.UTF8.GetString(ProtectedData.Unprotect(File.ReadAllBytes(KeyFile), null, DataProtectionScope.CurrentUser)); }
            catch { key = null; }
        }
        if (string.IsNullOrEmpty(key))
        {
            Console.Write("API key (hidden): ");
            key = ReadHidden();
            if (string.IsNullOrEmpty(key)) { Console.WriteLine("No key entered."); Pause(); return 1; }
            File.WriteAllBytes(KeyFile, ProtectedData.Protect(Encoding.UTF8.GetBytes(key), null, DataProtectionScope.CurrentUser));
            Console.WriteLine("Saved (encrypted for this Windows user).");
        }

        if (Array.IndexOf(args, "--code") < 0) return OpenDesktop(url, key);

        if (!HasClaude())
        {
            Console.WriteLine("Claude Code isn't installed yet. Installing it with Anthropic's official installer...");
            Run("powershell.exe", "-NoProfile -ExecutionPolicy Bypass -Command \"irm https://claude.ai/install.ps1 | iex\"", null, null);
            string local = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".local", "bin");
            Environment.SetEnvironmentVariable("PATH", local + ";" + Environment.GetEnvironmentVariable("PATH"));

        if (!HasClaude()) { Console.WriteLine("The install didn't finish. Install Claude Code from https://claude.com/claude-code and run this again."); Pause(); return 1; }
        }

        Console.WriteLine("Opening Claude with " + url + " ...");
        int code = Run("cmd.exe", "/c claude", url, key);
        if (code != 0) Pause();
        return code;
    }

    /// <summary>Points the Claude desktop app at the gateway (third-party inference policy) and opens it.</summary>
    static int OpenDesktop(string url, string key)
    {
        using (var k = Registry.CurrentUser.CreateSubKey(@"SOFTWARE\Policies\Claude"))
        {
            k.SetValue("inferenceProvider", "gateway", RegistryValueKind.String);
            k.SetValue("inferenceGatewayBaseUrl", url + "/v1", RegistryValueKind.String);
            k.SetValue("inferenceGatewayApiKey", key, RegistryValueKind.String);
        }
        // A running Claude reads its policy only at launch, so close it first.
        foreach (var p in Process.GetProcessesByName("claude")) { try { p.Kill(); p.WaitForExit(5000); } catch { } }

        string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string[] candidates = {
            Path.Combine(local, "AnthropicClaude", "claude.exe"),
            Path.Combine(local, "Programs", "Claude", "Claude.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Claude", "Claude.exe"),
        };
        foreach (var exe in candidates)
        {
            if (!File.Exists(exe)) continue;
            Console.WriteLine("Opening Claude with " + url + " ...");
            Process.Start(new ProcessStartInfo(exe) { UseShellExecute = true });
            return 0;
        }
        Console.WriteLine("The Claude desktop app isn't installed. Opening the download page: install it, then run this again.");
        Process.Start(new ProcessStartInfo("https://claude.ai/download") { UseShellExecute = true });
        Pause();
        return 1;
    }

    static bool HasClaude()
    {
        try { return Run("cmd.exe", "/c where claude >nul 2>nul", null, null) == 0; } catch { return false; }
    }

    static int Run(string file, string arguments, string url, string key)
    {
        var psi = new ProcessStartInfo(file, arguments) { UseShellExecute = false };
        if (url != null)
        {
            psi.EnvironmentVariables["ANTHROPIC_BASE_URL"] = url;
            psi.EnvironmentVariables["ANTHROPIC_AUTH_TOKEN"] = key;
            psi.EnvironmentVariables.Remove("ANTHROPIC_API_KEY");
        }
        using (var p = Process.Start(psi)) { p.WaitForExit(); return p.ExitCode; }
    }

    static string ReadHidden()
    {
        var sb = new StringBuilder();
        while (true)
        {
            var k = Console.ReadKey(true);
            if (k.Key == ConsoleKey.Enter) { Console.WriteLine(); return sb.ToString().Trim(); }
            if (k.Key == ConsoleKey.Backspace) { if (sb.Length > 0) sb.Length--; continue; }
            if (!char.IsControl(k.KeyChar)) sb.Append(k.KeyChar);
        }
    }

    static void Pause() { Console.WriteLine("Press any key to close."); Console.ReadKey(true); }
}
