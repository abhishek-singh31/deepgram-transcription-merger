import re

# Read the test.json file
with open('test.json', 'r') as f:
    content = f.read()

# Find and replace the pattern where participant_label is "debjyoti" followed by track: 1
# We need to handle the multi-line pattern
pattern = r'("participant_label": "debjyoti",\n\s+)"track": 1'
replacement = r'\1"track": 2'

# Replace all occurrences
updated_content = re.sub(pattern, replacement, content)

# Find and replace the pattern where track is 1 followed by participant_label "debjyoti"
# We need to handle the multi-line pattern
pattern = r'("track": 1,\n\s+)"participant_label": "debjyoti"'
replacement = r'\1"participant_label": "debjyoti"'

# Replace all occurrences
updated_content = re.sub(pattern, replacement, updated_content)


# Write back to the file
with open('test.json', 'w') as f:
    f.write(updated_content)

print("Successfully updated track values from 1 to 2 for participant_label 'debjyoti'")