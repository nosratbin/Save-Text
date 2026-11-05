const express = require('express');
const path = require('path');
const router = express.Router();
const shortid = require('shortid');
const Text = require('../models/Text');


function getExpiryDate(expireOption) {
    const now = new Date();
    switch (expireOption) {
        case '1 hour':
            return new Date(now.getTime() + 60 * 60 * 1000);
        case '1 day':
            return new Date(now.getTime() + 24 * 60 * 60 * 1000);
        case '1 week':
            return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        case '1 month':
            return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        case '1 year':
            return new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
        case 'no expire':
        default:
            return null;
    }
}

// MongoDB removes expired texts on a delay, so reads have to skip them as well.
function notExpired() {
    return { $or: [{ expireAt: null }, { expireAt: { $gt: new Date() } }] };
}

// Helper function to escape HTML characters
function escapeHtml(text) {
    return text.replace(/[&<>"']/g, function (match) {
        switch (match) {
            case '&':
                return '&amp;';
            case '<':
                return '&lt;';
            case '>':
                return '&gt;';
            case '"':
                return '&quot;';
            case "'":
                return '&#39;';
        }
    });
}

router.post('/save', async (req, res) => {
    const { title, content, expireOption } = req.body ?? {};
    if (!content || !content.trim()) {
        return res.status(400).json({ error: 'Text content cannot be empty!' });
    }
    const uniqueId = shortid.generate();
    const expireAt = getExpiryDate(expireOption);
    const newText = new Text({
        title: title || 'Untitled',
        content,
        expireOption,
        uniqueId,
        expireAt,
        userId: req.user ? req.user.id : null
    });
    try {
        await newText.save();
        console.log(`Text saved with ID: ${uniqueId}, Title: ${title}, Expires At: ${expireAt}`);

        res.json({ url: `${uniqueId}` });
    } catch (error) {
        console.error("Error saving text:", error);
        res.status(500).json({ error: 'Failed to save text' });
    }
});

router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { title, content, expireOption } = req.body ?? {};

    if (!content || !content.trim()) {
        return res.status(400).json({ error: 'Text content cannot be empty!' });
    }

    const query = { uniqueId: id };
    // If user is logged in, they can update their own texts OR public anonymous texts
    // If not logged in, they can only update public anonymous texts
    if (req.user) {
        query.$or = [{ userId: req.user.id }, { userId: null }];
    } else {
        query.userId = null; // Only allow updating anonymous texts if not logged in
    }

    query.$and = [notExpired()];

    try {
        const text = await Text.findOne(query);
        if (!text) {
            return res.status(404).json({ error: 'Text not found or you are not authorized to update it.' });
        }

        text.title = title || 'Untitled';
        text.content = content;
        // Editing a text keeps its countdown. Only picking a new option restarts it.
        if (expireOption !== text.expireOption) {
            text.expireOption = expireOption;
            text.expireAt = getExpiryDate(expireOption);
        }
        await text.save();

        res.json({ message: 'Text updated successfully', url: id, expireAt: text.expireAt });
    } catch (error) {
        console.error("Error updating text:", error);
        res.status(500).json({ error: 'Failed to update text' });
    }
});

router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    const query = { uniqueId: id };

    if (req.user) {
        query.$or = [{ userId: req.user.id }, { userId: null }];
    } else {
        query.userId = null;
    }

    try {
        const deletedText = await Text.findOneAndDelete(query);
        if (deletedText) {
            console.log(`Text deleted with ID: ${id}, Title: ${deletedText.title}`);
            res.json({ message: 'Text deleted successfully' });
        } else {
            res.status(404).json({ error: 'Text not found or you are not authorized to delete it.' });
        }
    } catch (error) {
        console.error("Error deleting text:", error);
        res.status(500).json({ error: 'Failed to delete text' });
    }
});

router.get('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const text = await Text.findOne({ uniqueId: id, ...notExpired() });
        if (text) {
            const escapedTitle = escapeHtml(text.title);
            const escapedContent = escapeHtml(text.content);

            // Determine if the current viewer can modify this text.
            // True if:
            // 1. The text is anonymous (text.userId is null)
            // 2. The user is logged in AND text.userId matches req.user.id
            let canModify = true;
            if (!text.userId) { // Anonymous text
                canModify = true;
            } else if (req.user && text.userId === req.user.id) { // Owned by current logged-in user
                canModify = true;
            }

            res.send(`
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>${escapedTitle || 'Untitled Text'}</title>
                    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
                    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500&display=swap" rel="stylesheet">
                    <link href="/theme.css" rel="stylesheet">
                    <script src="https://cdn.tailwindcss.com"></script>
                </head>
                <body class="app min-h-screen flex flex-col items-center justify-center p-4">
                    <div class="card w-full max-w-2xl">
                        <h1 class="page-title text-center mb-6">${escapedTitle || 'Untitled Text'}</h1>
                        
                        <label for="titleInput" class="label">Title</label>
                        <input type="text" id="titleInput" value="${escapedTitle || ''}" placeholder="Title" class="field">
                        
                        <label for="contentInput" class="label">Text</label>
                        <textarea id="contentInput" placeholder="Write or paste text" class="field h-72 md:h-80">${escapedContent}</textarea>
                        
                        <label for="expireOptionInput" class="label">Expiration</label>
                        <select id="expireOptionInput" class="field">
                            <option value="no expire" ${text.expireOption === 'no expire' ? 'selected' : ''}>No expiry</option>
                            <option value="1 hour" ${text.expireOption === '1 hour' ? 'selected' : ''}>1 hour</option>
                            <option value="1 day" ${text.expireOption === '1 day' ? 'selected' : ''}>1 day</option>
                            <option value="1 week" ${text.expireOption === '1 week' ? 'selected' : ''}>1 week</option>
                            <option value="1 month" ${text.expireOption === '1 month' ? 'selected' : ''}>1 month</option>
                            <option value="1 year" ${text.expireOption === '1 year' ? 'selected' : ''}>1 year</option>
                        </select>
                        <p id="expiresAt" class="subtitle mb-4" data-at="${text.expireAt ? text.expireAt.toISOString() : ''}"></p>
                        
                        <div class="actions">
                            <button id="saveBtn" onclick="saveText()" class="btn btn-primary">Save</button>
                            <button onclick="viewRaw()" class="btn">View raw</button>
                            <button onclick="copyText()" class="btn">Copy</button>
                            <button id="deleteBtn" onclick="deleteText()" class="btn btn-danger actions-end">Delete</button>
                        </div>
                        <p id="notice" class="notice" role="status"></p>

                        <p class="mt-6"><a href="/" class="text-link">Back to home</a></p>
                    </div>
                    
                    <script>
                        const textId = '${id}';
                        const currentToken = localStorage.getItem('token');
                        const canModifyClient = ${canModify}; // Use the server-determined value

                        function notify(message, tone) {
                            const notice = document.getElementById('notice');
                            notice.textContent = message;
                            notice.dataset.tone = tone || '';
                        }

                        function showExpiry(value) {
                            document.getElementById('expiresAt').textContent = value ? 'Expires ' + new Date(value).toLocaleString() : '';
                        }
                        showExpiry(document.getElementById('expiresAt').dataset.at);

                        const titleField = document.getElementById('titleInput');
                        const contentField = document.getElementById('contentInput');
                        const expireOptionField = document.getElementById('expireOptionInput');
                        const saveButton = document.getElementById('saveBtn');
                        const deleteButton = document.getElementById('deleteBtn');

                        if (!canModifyClient) {
                            titleField.disabled = true;
                            contentField.disabled = true;
                            expireOptionField.disabled = true;
                            saveButton.disabled = true;
                            deleteButton.disabled = true;

                            [titleField, contentField, expireOptionField, saveButton, deleteButton].forEach(el => {
                                el.classList.add('opacity-70', 'cursor-not-allowed');
                            });
                        }

                        function viewRaw() {
                            window.open('/api/texts/' + textId + '/raw', '_blank');
                        }

                        function copyText() {
                            contentField.select();
                            contentField.setSelectionRange(0, 99999); // For mobile devices
                            try {
                                document.execCommand('copy');
                            } catch (err) {
                                notify('Could not copy the text', 'error');
                            }
                        }

                        async function saveText() {
                            if (!canModifyClient) {
                                notify('You cannot edit this text', 'error');
                                return;
                            }
                            const title = titleField.value;
                            const content = contentField.value;
                            const expireOption = expireOptionField.value;

                            if (!content.trim()) {
                                notify('Add some text first', 'error');
                                return;
                            }
                            
                            const requestHeaders = { 'Content-Type': 'application/json' };
                            if (currentToken) {
                                requestHeaders['Authorization'] = 'Bearer ' + currentToken;
                            }

                            try {
                                const response = await fetch('/api/texts/' + textId, {
                                    method: 'PUT',
                                    headers: requestHeaders,
                                    body: JSON.stringify({ title, content, expireOption })
                                });
                                const result = await response.json();
                                if (response.ok) {
                                    notify('Saved');
                                    showExpiry(result.expireAt);
                                    document.querySelector('h1').textContent = title || 'Untitled Text';
                                    document.title = title || 'Untitled Text';
                                } else {
                                    notify(result.error || 'Could not update the text', 'error');
                                }
                            } catch (error) {
                                console.error('Error updating text:', error);
                                notify('Could not update the text. Try again', 'error');
                            }
                        }

                        async function deleteText() {
                             if (!canModifyClient) {
                                notify('You cannot delete this text', 'error');
                                return;
                            }
                            if (!confirm('Delete this text?')) {
                                return;
                            }

                            const requestHeaders = {};
                            if (currentToken) {
                                requestHeaders['Authorization'] = 'Bearer ' + currentToken;
                            }

                            try {
                                const response = await fetch('/api/texts/' + textId, {
                                    method: 'DELETE',
                                    headers: requestHeaders
                                });
                                if (response.ok) {
                                    window.location.href = '/';
                                } else {
                                    const result = await response.json().catch(() => ({error: 'Failed to delete text.'}));
                                    notify(result.error || 'Could not delete the text', 'error');
                                }
                            } catch (error) {
                                console.error('Error deleting text:', error);
                                notify('Could not delete the text. Try again', 'error');
                            }
                        }
                    </script>
                </body>
                </html>
            `);
        } else {
            res.status(404).sendFile(path.join(__dirname, '..', 'public', '404.html'));
        }
    } catch (error) {
        console.error("Error fetching text by ID:", error);
        res.status(500).send(`
             <!DOCTYPE html>
             <html lang="en">
             <head>
                 <meta charset="UTF-8">
                 <meta name="viewport" content="width=device-width, initial-scale=1.0">
                 <title>Server error</title>
                 <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500&display=swap" rel="stylesheet">
                 <link href="/theme.css" rel="stylesheet">
                 <script src="https://cdn.tailwindcss.com"></script>
             </head>
             <body class="app min-h-screen flex flex-col items-center justify-center p-4">
                 <div class="text-center">
                     <h1 class="page-title mb-2">Server error</h1>
                     <p class="subtitle mb-6">Something went wrong on our end. Please try again later.</p>
                     <a href="/" class="btn btn-primary">Go to homepage</a>
                 </div>
             </body>
             </html>
        `);
    }
});

router.get('/:id/raw', async (req, res) => {
    const { id } = req.params;
    try {
        const text = await Text.findOne({ uniqueId: id, ...notExpired() });
        if (text) {
            res.type('text/plain');
            res.send(text.content);
        } else {
            res.status(404).type('text/plain').send('Text not found');
        }
    } catch (error) {
        console.error("Error fetching raw text:", error);
        res.status(500).type('text/plain').send('Failed to fetch raw text');
    }
});


router.get('/', async (req, res) => {
    try {
        // The sidebar only needs links, so leave the text content in the database.
        const listFields = 'uniqueId title';
        const publicTexts = await Text.find({ userId: null, ...notExpired() }).select(listFields).lean();
        let myTexts = [];
        
        if (req.user) {
            myTexts = await Text.find({ userId: req.user.id, ...notExpired() }).select(listFields).lean();
        }
        
        res.json({ myTexts, publicTexts });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch texts' });
    }
});

module.exports = router;