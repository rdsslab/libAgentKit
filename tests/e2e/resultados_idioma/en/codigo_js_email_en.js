function isValidEmail(email) {
  // Regular expression pattern to validate an email address
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  
  // Check if the email matches the pattern
  return emailRegex.test(email);
}