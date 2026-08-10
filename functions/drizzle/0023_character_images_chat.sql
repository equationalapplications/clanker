-- Chat photos are gallery rows that also name the message they arrived on.
-- Deliberately NOT a foreign key to messages: syncCharacterImages and message
-- sync are independent flows that can land in either order, so a device may
-- legitimately register an image for a message the server has not received yet.
-- A FK would reject that write and strand the image.
ALTER TABLE character_images ADD COLUMN message_id text;
