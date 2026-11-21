<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Patitas Felices</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: Arial, sans-serif;
    background-color: #f4f4f9;
    color: #333;
  }
  .container {
    max-width: 800px;
    margin: 0 auto;
    padding: 20px;
  }
  header {
    background-color: #2c3e50;
    color: #ecf0f1;
    padding: 20px;
    text-align: center;
  }
  header h1 { margin: 0; }
  nav {
    background-color: #34495e;
    color: #ecf0f1;
    padding: 10px;
    text-align: center;
  }
  nav a {
    color: #ecf0f1;
    text-decoration: none;
    margin: 0 10px;
    font-size: 1.2em;
  }
  nav a:hover { text-decoration: underline; }
  .menu-toggle {
    display: flex;
    align-items: center;
    gap: 10px;
    background-color: #2c3e50;
    color: #ecf0f1;
    padding: 10px;
    border-radius: 5px;
    cursor: pointer;
  }
  .menu-toggle button {
    width: 30px;
    height: 30px;
    background-color: #2c3e50;
    color: #ecf0f1;
    border: none;
    border-radius: 50%;
    cursor: pointer;
  }
  .menu-toggle button:hover { background-color: #4e79a7; }
  .menu-toggle button.active { background-color: #2c3e50; }
  .menu-toggle button.active::after {
    content: '';
    width: 30px;
    height: 30px;
    background-color: #ecf0f1;
    border-radius: 50%;
  }
  .menu-toggle.active button {
    background-color: #ecf0f1;
  }
  .form-group {
    margin-bottom: 20